import type { SalesPromptProduct } from "@chatbotx.io/business"
import { conversationService } from "@chatbotx.io/business"
import {
  type AIAgentSalesProfile,
  type ConversationSalesStage,
  type ConversationSalesState,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@chatbotx.io/database/partials"
import type {
  AIAgentModel,
  ContactInboxModel,
  ConversationModel,
} from "@chatbotx.io/database/types"
import { emit } from "@chatbotx.io/event-bus"
import { percentOf, roundMoney } from "@chatbotx.io/utils/money"
import { generateText, type LanguageModel, type ModelMessage, Output } from "ai"
import { normalizeError } from "universal-error-normalizer"
import { z } from "zod"
import type { ReplyAIProvider } from "../../../lib/ai/reply-model"
import { logger } from "../../../lib/logger"
import { handoffExecutorService } from "../../../trigger/services/handoff-executor.service"
import { sendMessageAndWait } from "../../utils/message"
import type { ParsedRichResponse, RichMessengerMessage } from "../rich-response"

export const TIER2_JUDGE_TIMEOUT_MS = 4000
export const REWRITE_TIMEOUT_MS = 10_000
const PRICE_ROUNDING_TOLERANCE = 0.005

export type SalesGuardOutcome = "passed" | "rewritten" | "fallback" | "handoff"

export type Tier1CheckResult = {
  passed: boolean
  reason?: "invented_price"
  unmatchedValues: number[]
}

export type Tier2JudgeOutput = {
  onTopic: boolean
  inRole: boolean
  customerAskedForHuman: boolean
  matchedHandoffTrigger: boolean
  stage: ConversationSalesStage
  mentionedProductIds: string[]
}

const tier2JudgeOutputSchema = z.object({
  onTopic: z.boolean(),
  inRole: z.boolean(),
  customerAskedForHuman: z.boolean(),
  matchedHandoffTrigger: z.boolean(),
  stage: z.enum(["discover", "pitch", "objection", "alternative", "close"]),
  mentionedProductIds: z.array(z.string()),
})

function addValueAndUnitVariants(
  set: Set<number>,
  amount: number,
  currency: string,
) {
  if (!Number.isFinite(amount) || amount < 0) {
    return
  }
  set.add(amount)
  if (currency.toUpperCase() === "VND" && amount >= 1000) {
    // Allow shorthand representations only when scaled by the parser back to base VND,
    // plus keep exact base amount.
    set.add(Math.round(amount))
  }
}

export function buildAllowedPriceAndPercentSets(
  products: SalesPromptProduct[],
): {
  allowedPrices: number[]
  allowedPercents: number[]
} {
  const priceSet = new Set<number>()
  const percentSet = new Set<number>()

  for (const product of products) {
    const currency = product.currency || "VND"
    const price = Number(product.price)
    const discountPercent = Number(product.discount ?? 0)
    addValueAndUnitVariants(priceSet, price, currency)

    if (discountPercent > 0) {
      const discountAmount = percentOf(price, discountPercent, currency)
      addValueAndUnitVariants(priceSet, discountAmount, currency)
      addValueAndUnitVariants(
        priceSet,
        Math.max(0, roundMoney(price - discountAmount, currency)),
        currency,
      )
      percentSet.add(discountPercent)
      percentSet.add(Math.round(discountPercent))
    }

    for (const variant of product.variants ?? []) {
      if (variant.isEnabled === false) {
        continue
      }
      const vPrice = Number(variant.price)
      addValueAndUnitVariants(priceSet, vPrice, currency)
      if (discountPercent > 0) {
        const vDiscountAmount = percentOf(vPrice, discountPercent, currency)
        addValueAndUnitVariants(
          priceSet,
          Math.max(0, roundMoney(vPrice - vDiscountAmount, currency)),
          currency,
        )
      }
    }
  }

  return {
    allowedPrices: [...priceSet],
    allowedPercents: [...percentSet],
  }
}

function matchesWithTolerance(
  candidate: number,
  allowedList: number[],
): boolean {
  for (const allowed of allowedList) {
    if (allowed === 0) {
      if (candidate === 0) {
        return true
      }
      continue
    }
    const diffRatio = Math.abs(candidate - allowed) / Math.abs(allowed)
    if (diffRatio <= PRICE_ROUNDING_TOLERANCE) {
      return true
    }
  }
  return false
}

export type ExtractedMoneyTokens = {
  prices: number[]
  percents: number[]
}

const PERCENT_RE = /(?:^|[^\w/])(\d+(?:[.,]\d+)?)\s*%/gi

const DISCOUNT_KEYWORD_BEFORE_PERCENT_RE =
  /(?:giảm|giam|off|sale|discount|chiết\s*khấu|chiet\s*khau|khuyến\s*mãi|khuyen\s*mai|ưu\s*đãi|uu\s*dai|voucher|coupon|tiết\s*kiệm|tiet\s*kiem|hoàn\s*tiền|hoan\s*tien|trợ\s*giá|tro\s*gia)\s*(?:giá|gia)?\s*(?:lên\s*tới|len\s*toi|lên\s*đến|len\s*den|đến|den|tới|toi|thêm|them|sâu|sau|mạnh|manh|ngay|nhanh)?\s*[-~:]?\s*$/iu
const PRICE_BEFORE_PERCENT_RE =
  /(?:\d[\d.,]*\s*(?:k|tr|triệu|trieu|ngàn|ngan|nghìn|nghin|đ|₫|vnd|vnđ|đồng|dong|\$|usd)?)\s*[(\-[~]\s*$/iu
// Same-line horizontal whitespace only (incl. NBSP) so a discount label on
// the next line does not turn a product percentage like `Cotton 100%` into
// a discount claim, while `20% off` with U+00A0 still parses.
// `off` must not be hyphen-joined to a product-attribute word (`off-grid`,
// `off-road`, `off-lease`…) even when a discount label follows — that is a
// product name. Only recognized promotion modifiers (`off-peak`,
// `off-season`, `off-hours`, `off-invoice`, `off-list`, `off-menu`…)
// before a discount or sale label form a discount claim.
const DISCOUNT_KEYWORD_AFTER_PERCENT_RE =
  /^[^\S\n]*(?:off(?!-\w)\b|off-(?:peak|season|hours?|days?|weekends?|weekdays?|invoice|list|menu|contract)[^\S\n]+(?:discount|giảm|giam|sale)\b|discount|giảm|giam)\b/iu
const OPEN_PAREN_BEFORE_PERCENT_RE = /\(\s*$/
const CLOSE_PAREN_AFTER_PERCENT_RE = /^[^\S\n]*\)/
// Titles that are just an offer qualifier plus a percentage: `20%`,
// `Up to 20%`, `Tối đa 20%`. Anything richer (a price, a product attribute
// like `Cotton 100%`) must stay on its own line.
const CARD_PERCENT_ONLY_TITLE_RE =
  /^\s*(?:up\s+to|tối\s*đa|toi\s*da|lên\s*đến|len\s*den)?\s*\d+(?:[.,]\d+)?\s*%\s*$/iu

// E.g. "1tr99", "1tr5", "2 triệu 5". Use [ \t]* (not \s*) so a price at the
// end of one message chunk cannot merge with a label on the next chunk
// (e.g. "Giá 2 triệu" + "24 tháng" must not parse as 2_240_000).
const VND_TRIEU_COMPOUND_RE =
  /(?:^|[^\w/])(\d+)[ \t]*(?:tr|triệu|trieu)[ \t]*(\d{1,3})\b/gi

// E.g. "1.99tr", "1,5 triệu", "2tr". The lookahead also stays same-line so a
// digit on the next chunk does not suppress the simple match either.
const VND_TRIEU_SIMPLE_RE =
  /(?:^|[^\w/])(\d+(?:[.,]\d+)?)[ \t]*(?:tr|triệu|trieu)\b(?![ \t]*\d)/gi

// E.g. "500k", "1990k", "250 ngàn", "250 nghìn", "250k đ"
const VND_THOUSAND_RE =
  /(?:^|[^\w/])(\d+(?:[.,]\d+)?)\s*(?:k|ngàn|ngan|nghìn|nghin)\b/gi

const GROUPED_THOUSAND_SHORTHAND_RE = /^\d{1,3}[.,]\d{3}$/

// E.g. "$49", "$49.99", "USD 49"
const USD_PREFIX_RE =
  /(?:^|[^\w/])(?:\$|usd\s*)(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\b/gi

// E.g. "49$", "49 USD"
const USD_SUFFIX_RE =
  /(?:^|[^\w/])(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:\$|usd\b)/gi

// E.g. "1.990.000đ", "1,990,000 vnđ", "500.000 vnd", "1990000 đồng"
// Note: JavaScript \b is ASCII-only, so after non-ASCII 'đ', '₫', 'đồng', use (?=$|[^\p{L}\p{N}_]) with the 'u' flag.
const VND_CURRENCY_SUFFIX_RE =
  /(?:^|[^\p{L}\p{N}_/])(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*(?:đ|₫|vnd|vnđ|đồng|dong)(?=$|[^\p{L}\p{N}_])/giu

// Grouped thousands without explicit currency suffix, e.g. "1.990.000" or "1,990,000" (at least 2 groups or >= 100.000)
const GROUPED_MONEY_RE =
  /(?:^|[^\p{L}\p{N}_/.])(\d{1,3}(?:\.\d{3}){2,}|\d{1,3}(?:,\d{3}){2,}|\d{3}(?:[.,]\d{3}))(?![.\d])/gu

function parseGroupedNumber(raw: string): number {
  const cleaned = raw.replace(/[.,]/g, "")
  return Number.parseFloat(cleaned)
}

function parseDecimalNumber(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."))
}

export function extractMoneyAndPercentTokens(
  rawText: string,
): ExtractedMoneyTokens {
  // Strip URLs so numbers in query strings or paths are never mistaken for prices.
  let text = rawText.replace(/https?:\/\/\S+/gi, " ")

  const prices: number[] = []
  const percents: number[] = []

  text = text.replace(
    PERCENT_RE,
    (full, numStr: string, offset: number, source: string) => {
      // offset sits on the separator PERCENT_RE consumed before the digits,
      // so include it: `2.500.000đ (50%)` keeps its `(` in `before`.
      const before = source.slice(Math.max(0, offset - 60), offset + 1)
      // Look far enough to see a discount label behind a promotion
      // modifier (`off-peak discount`) — `[^\S\n]` keeps it same-line.
      const after = source.slice(
        offset + full.length,
        offset + full.length + 64,
      )
      // A `(N%)` suffix right after a price only counts as a discount when
      // the parenthesis closes right after the percent or a discount label
      // follows: `2.500.000đ (50%)` is a discount, `2.500.000đ (100% online)`
      // is a product attribute.
      const isParenPriceSuffix =
        PRICE_BEFORE_PERCENT_RE.test(before) &&
        OPEN_PAREN_BEFORE_PERCENT_RE.test(before)
      const isDiscountPercent =
        DISCOUNT_KEYWORD_BEFORE_PERCENT_RE.test(before) ||
        DISCOUNT_KEYWORD_AFTER_PERCENT_RE.test(after) ||
        (isParenPriceSuffix
          ? CLOSE_PAREN_AFTER_PERCENT_RE.test(after)
          : PRICE_BEFORE_PERCENT_RE.test(before))
      if (!isDiscountPercent) {
        return full
      }
      const value = parseDecimalNumber(numStr)
      if (Number.isFinite(value)) {
        percents.push(value)
      }
      return " "
    },
  )

  // 2. Compound triệu: "1tr99" -> 1_990_000, "1tr5" -> 1_500_000
  text = text.replace(
    VND_TRIEU_COMPOUND_RE,
    (_full, millionsStr: string, remainderStr: string) => {
      const millions = Number.parseInt(millionsStr, 10)
      const scale = 10 ** (6 - remainderStr.length)
      const remainder = Number.parseInt(remainderStr, 10) * scale
      const value = millions * 1_000_000 + remainder
      if (Number.isFinite(value)) {
        prices.push(value)
      }
      return " "
    },
  )

  // 3. Simple triệu: "1.5tr" -> 1_500_000
  text = text.replace(VND_TRIEU_SIMPLE_RE, (_full, numStr: string) => {
    const value = parseDecimalNumber(numStr) * 1_000_000
    if (Number.isFinite(value)) {
      prices.push(value)
    }
    return " "
  })

  // 4. Thousand shorthand: "1990k" -> 1_990_000, "500k" -> 500_000
  text = text.replace(VND_THOUSAND_RE, (_full, numStr: string) => {
    // If numStr has 3 digits after dot/comma like "1.990k", treat as 1990 * 1000
    const isGroupedThousand = GROUPED_THOUSAND_SHORTHAND_RE.test(numStr)
    const base = isGroupedThousand
      ? parseGroupedNumber(numStr)
      : parseDecimalNumber(numStr)
    const value = base * 1000
    if (Number.isFinite(value)) {
      prices.push(value)
    }
    return " "
  })

  // 5. USD prefix/suffix
  const collectUsd = (_full: string, numStr: string) => {
    const value = Number.parseFloat(numStr.replace(/,/g, ""))
    if (Number.isFinite(value)) {
      prices.push(value)
    }
    return " "
  }
  text = text.replace(USD_PREFIX_RE, collectUsd)
  text = text.replace(USD_SUFFIX_RE, collectUsd)

  // 6. VND explicit suffix
  text = text.replace(VND_CURRENCY_SUFFIX_RE, (_full, numStr: string) => {
    const value = parseGroupedNumber(numStr)
    if (Number.isFinite(value)) {
      prices.push(value)
    }
    return " "
  })

  // 7. Bare grouped money numbers (e.g., 1.990.000 or 1,990,000)
  text = text.replace(GROUPED_MONEY_RE, (_full, numStr: string) => {
    const value = parseGroupedNumber(numStr)
    if (Number.isFinite(value)) {
      prices.push(value)
    }
    return " "
  })

  return { prices, percents }
}

export function checkTier1Prices(input: {
  replyText: string
  products: SalesPromptProduct[]
}): Tier1CheckResult {
  const { prices, percents } = extractMoneyAndPercentTokens(input.replyText)
  if (prices.length === 0 && percents.length === 0) {
    return { passed: true, unmatchedValues: [] }
  }

  const { allowedPrices, allowedPercents } = buildAllowedPriceAndPercentSets(
    input.products,
  )
  const unmatchedValues: number[] = []

  for (const price of prices) {
    if (!matchesWithTolerance(price, allowedPrices)) {
      unmatchedValues.push(price)
    }
  }

  for (const pct of percents) {
    if (!matchesWithTolerance(pct, allowedPercents)) {
      unmatchedValues.push(pct)
    }
  }

  if (unmatchedValues.length > 0) {
    return {
      passed: false,
      reason: "invented_price",
      unmatchedValues,
    }
  }

  return { passed: true, unmatchedValues: [] }
}

const BOT_DISCLOSURE_PATTERNS: readonly RegExp[] = [
  /(?:em|tôi|mình|tớ|chúng\s+tôi|chúng\s+em)\s+(?:là|chỉ\s+là|thuộc)\s+(?:một\s+)?(?:con\s+)?(?:trợ\s+lý\s+ảo\s+)?(?:AI|bot|chatbot)(?=$|[^\p{L}\p{N}_])/iu,
  /(?:đây|đó)\s+là\s+(?:một\s+)?(?:con\s+)?(?:AI|bot|chatbot)(?=$|[^\p{L}\p{N}_])/iu,
  /(?:^|[^\p{L}\p{N}_])(?:AI|bot|chatbot)\s+(?:assistant|trợ\s+lý)(?=$|[^\p{L}\p{N}_])/iu,
  /(?:^|[^\p{L}\p{N}_])(?:i'?m|i\s+am|we'?re|we\s+are)\s+(?:a\s+|an\s+|the\s+|your\s+)?(?:virtual\s+assistant|AI|bot|chatbot)(?=$|[^\p{L}\p{N}_])/iu,
  // Demonstrative openings need an article: `This is AI Solutions` names a
  // business, `This is an AI assistant` is self-disclosure.
  /(?:^|[^\p{L}\p{N}_])(?:this\s+is|here'?s)\s+(?:a\s+|an\s+|the\s+|your\s+)(?:virtual\s+assistant|AI|bot|chatbot)(?=$|[^\p{L}\p{N}_])/iu,
  // Bare `This is AI.` still self-discloses when the noun ends at sentence
  // punctuation; `This is AI Solutions` keeps its business name.
  // `,;!?` always end the identity; `:` only exempts a numeric suffix
  // (`AI:101`) and `.` a domain/number (`AI.com`, `AI.5`), so
  // `This is AI,please wait.` and `This is AI!👋` still disclose.
  /(?:^|[^\p{L}\p{N}_])(?:this\s+is|here'?s)\s+(?:AI|bot|chatbot)(?=$|[!?,;]|:(?![\p{Nd}\p{Nl}])|\.(?![\p{L}\p{N}]))/iu,
  /trợ\s+lý\s+ảo/iu,
  /human\s+agent/iu,
]

const CUSTOMER_ASKED_BOT_OR_HUMAN_PATTERNS: readonly RegExp[] = [
  /(?:^|[^\p{L}\p{N}_])(?:bot|chatbot|ai)\s*(?:à|hả|vậy|không|phải\s*không|đúng\s*không|hở|chứ)(?=$|[^\p{L}\p{N}_])/iu,
  /(?:có\s*phải|phải\s*là|đây\s*là|em\s*là|bạn\s*là)\s*(?:bot|chatbot|ai|trợ\s*lý\s*ảo)(?=$|[^\p{L}\p{N}_])/iu,
  /người\s*thật\s*(?:không|à|hả|hay\s*bot|hay\s*ai)/iu,
  /có\s*phải\s*người\s*thật/iu,
]

export function containsBotSelfDisclosure(text: string): boolean {
  return BOT_DISCLOSURE_PATTERNS.some((pattern) => pattern.test(text))
}

export function isCustomerAskingBotOrHuman(text: string): boolean {
  return CUSTOMER_ASKED_BOT_OR_HUMAN_PATTERNS.some((pattern) =>
    pattern.test(text),
  )
}

// Word boundary after the noun is required: `đây là Botanic Spa` must not
// become `đây là tư vấn viênanic Spa`.
const STRIP_SELF_ID_RE =
  /((?:em|tôi|mình|tớ|chúng\s+tôi|chúng\s+em|đây|đó)\s+(?:là|chỉ\s+là|thuộc)\s+(?:một\s+)?(?:con\s+)?)(?:AI|bot|chatbot)(?=$|[^\p{L}\p{N}_])/giu
const STRIP_SELF_ID_EN_RE =
  /((?:^|[^\p{L}\p{N}_])(?:i'?m|i\s+am|we'?re|we\s+are)\s+(?:a\s+|an\s+|the\s+|your\s+)?)(?:virtual\s+assistant|AI\s+assistant|AI|bot|chatbot)(?=$|[^\p{L}\p{N}_])/giu
// Same article requirement as the screening pattern so `This is AI Solutions
// support` keeps its business name.
const STRIP_SELF_ID_EN_DEMO_RE =
  /((?:^|[^\p{L}\p{N}_])(?:this\s+is|here'?s)\s+(?:a\s+|an\s+|the\s+|your\s+))(?:virtual\s+assistant|AI\s+assistant|AI|bot|chatbot)(?=$|[^\p{L}\p{N}_])/giu
const STRIP_SELF_ID_EN_DEMO_BARE_RE =
  /((?:^|[^\p{L}\p{N}_])(?:this\s+is|here'?s)\s+)(?:AI|bot|chatbot)(?=$|[!?,;]|:(?![\p{Nd}\p{Nl}])|\.(?![\p{L}\p{N}]))/giu
const STRIP_TRO_LY_AO_RE = /trợ\s+lý\s+ảo/giu
const STRIP_HUMAN_AGENT_RE = /human\s+agent/giu
const MULTI_SPACE_RE = /\s{2,}/g

function stripBotDisclosureWords(text: string): string {
  return text
    .replace(STRIP_SELF_ID_RE, "$1tư vấn viên")
    .replace(STRIP_SELF_ID_EN_RE, "$1tư vấn viên")
    .replace(STRIP_SELF_ID_EN_DEMO_RE, "$1tư vấn viên")
    .replace(STRIP_SELF_ID_EN_DEMO_BARE_RE, "$1tư vấn viên")
    .replace(STRIP_TRO_LY_AO_RE, "tư vấn viên")
    .replace(STRIP_HUMAN_AGENT_RE, "tư vấn viên")
    .replace(MULTI_SPACE_RE, " ")
    .trim()
}

export function resolveSalesHandoffMessage(
  profile: Pick<AIAgentSalesProfile, "handoffMessage">,
): string {
  const candidate = stripBotDisclosureWords(
    profile.handoffMessage?.trim() || "",
  )
  return candidate || DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE
}

export function buildSalesFallbackReply(input: {
  profile: AIAgentSalesProfile
  products: SalesPromptProduct[]
}): string {
  const activeProductsById = new Map(
    input.products
      .filter((p) => !p.status || p.status === "active")
      .map((p) => [p.id, p]),
  )
  const topTarget = [...input.profile.targetProducts]
    .sort((a, b) => a.priority - b.priority)
    .find((t) => activeProductsById.has(t.productId))
  const topProduct = topTarget
    ? activeProductsById.get(topTarget.productId)
    : undefined

  const rawObjective =
    input.profile.objective.trim() ||
    (topProduct ? `sản phẩm ${topProduct.name}` : "sản phẩm phù hợp")
  const objectiveText =
    stripBotDisclosureWords(rawObjective) || "sản phẩm phù hợp"

  if (topProduct) {
    const currency = topProduct.currency || "VND"
    const discountAmount = percentOf(
      topProduct.price,
      topProduct.discount ?? 0,
      currency,
    )
    const finalPrice = Math.max(
      0,
      roundMoney(topProduct.price - discountAmount, currency),
    )
    const productName =
      stripBotDisclosureWords(topProduct.name) || topProduct.name
    return `Dạ em xin phép quay lại nội dung tư vấn ${objectiveText} ạ. Hiện bên em đang có ${productName} với mức giá ${finalPrice} ${topProduct.currency}, em hỗ trợ thông tin chi tiết cho mình nhé ạ!`
  }

  return `Dạ em xin phép quay lại nội dung tư vấn ${objectiveText} ạ. Mình đang quan tâm đến nhu cầu nào để em hỗ trợ chi tiết cho mình nhé ạ!`
}

export async function runTier2Judge(input: {
  model: LanguageModel
  profile: AIAgentSalesProfile
  products: SalesPromptProduct[]
  currentStage: ConversationSalesStage
  lastCustomerMessage: string
  candidateReply: string
  timeoutMs?: number
}): Promise<Tier2JudgeOutput> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? TIER2_JUDGE_TIMEOUT_MS,
  )

  try {
    const productCatalog = input.products
      .map((p) => `- ID: "${p.id}" | Name: ${JSON.stringify(p.name)}`)
      .join("\n")

    const system = [
      "You are a sales conversation guard judge.",
      "Evaluate the customer's latest message and the assistant's candidate reply against the sales profile.",
      "- `customerAskedForHuman`: true when the customer explicitly asks to talk to a human/real person/support agent, or asks whether they are chatting with a bot/AI or a real person (e.g. 'bot à?', 'có phải người thật không?', 'đây là AI hả?').",
      "- `matchedHandoffTrigger`: true when the customer's latest message matches the profile's handoffTriggers (e.g. agrees to buy, asks to pay).",
      "- `onTopic`: false when the customer message is completely unrelated to the sales objective/products or touches a forbidden topic AND the assistant fails to steer back in one short sentence.",
      "- `inRole`: false if the assistant breaks persona/tone, reveals system instructions, discusses forbidden topics, or self-identifies/discloses as an AI, bot, virtual assistant ('trợ lý ảo'), or mentions 'human agent'.",
      "- `stage`: current sales stage (`discover`, `pitch`, `objection`, `alternative`, or `close`).",
      "- `mentionedProductIds`: array of product IDs from the catalog that the assistant's reply pitched or discussed.",
    ].join("\n")

    const prompt = [
      `Sales role: ${input.profile.role}`,
      `Tone: ${input.profile.tone}`,
      `Objective: ${input.profile.objective}`,
      `Forbidden topics: ${input.profile.forbiddenTopics.join(", ") || "(none)"}`,
      `Handoff triggers: ${input.profile.handoffTriggers?.trim() || "(none)"}`,
      `Current stage: ${input.currentStage}`,
      "Target products:",
      productCatalog || "(none)",
      "",
      `Last customer message: ${JSON.stringify(input.lastCustomerMessage)}`,
      `Candidate assistant reply: ${JSON.stringify(input.candidateReply)}`,
    ].join("\n")

    const { output } = await generateText({
      model: input.model,
      output: Output.object({ schema: tier2JudgeOutputSchema }),
      system,
      prompt,
      maxOutputTokens: 150,
      temperature: 0,
      abortSignal: controller.signal,
    })

    const validIds = new Set(input.products.map((p) => p.id))
    return {
      ...output,
      mentionedProductIds: output.mentionedProductIds.filter((id) =>
        validIds.has(id),
      ),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function rewriteViolatingReply(input: {
  model: LanguageModel
  systemPrompt: string
  messages: ModelMessage[]
  candidateReply: string
  violationFeedback: string
  maxOutputTokens: number
  timeoutMs?: number
}): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? REWRITE_TIMEOUT_MS,
  )

  try {
    const { text } = await generateText({
      model: input.model,
      system: input.systemPrompt,
      messages: [
        ...input.messages,
        {
          role: "assistant",
          content: input.candidateReply,
        },
        {
          role: "user",
          content: `[SYSTEM GUARD FEEDBACK]: Câu trả lời trên vi phạm quy tắc: ${input.violationFeedback}. Hãy viết lại câu trả lời đúng vai trò, chỉ dùng đúng giá trong danh sách sản phẩm và dẫn dắt về mục tiêu tư vấn. Chỉ xuất câu trả lời đã sửa.`,
        },
      ],
      maxOutputTokens: input.maxOutputTokens,
      temperature: 0,
      abortSignal: controller.signal,
    })
    return text.trim()
  } finally {
    clearTimeout(timeoutId)
  }
}

export function extractLastCustomerText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg?.role !== "user") {
      continue
    }
    if (typeof msg.content === "string") {
      return msg.content
    }
    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter(
          (part): part is { type: "text"; text: string } =>
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            part.type === "text" &&
            "text" in part &&
            typeof part.text === "string",
        )
        .map((part) => part.text)
      if (textParts.length > 0) {
        return textParts.join("\n")
      }
    }
  }
  return ""
}

export function extractRichResponseTexts(rich: ParsedRichResponse): string {
  const chunks: string[] = []
  for (const item of rich.messages) {
    if (typeof item === "number") {
      continue
    }
    if ("message" in item && item.message && typeof item.message === "object") {
      const msg = item.message as RichMessengerMessage
      if (msg.text) {
        chunks.push(msg.text)
      }
      for (const quickReply of msg.quick_replies ?? []) {
        chunks.push(quickReply.title)
      }
      if (msg.attachment?.type === "template") {
        const payload = msg.attachment.payload
        if (payload.template_type === "button") {
          chunks.push(payload.text)
          for (const button of payload.buttons) {
            chunks.push(button.title)
          }
        } else if (payload.template_type === "generic") {
          for (const el of payload.elements) {
            // A percent-only title with a discount label subtitle is one
            // claim split across fields — join it. Anything else stays on
            // separate lines so `Giá 2 triệu` + `24 tháng bảo hành` does not
            // merge into 2_240_000 and `Cotton 100%` is not a discount.
            if (
              el.subtitle &&
              CARD_PERCENT_ONLY_TITLE_RE.test(el.title) &&
              DISCOUNT_KEYWORD_AFTER_PERCENT_RE.test(el.subtitle)
            ) {
              chunks.push(`${el.title.trim()} ${el.subtitle.trim()}`)
            } else {
              chunks.push(el.title)
              if (el.subtitle) {
                chunks.push(el.subtitle)
              }
            }
            for (const button of el.buttons) {
              chunks.push(button.title)
            }
          }
        }
      }
    }
  }
  return chunks.join("\n")
}

export type EvaluateSalesGuardInput = {
  conversation: ConversationModel
  contactInbox: ContactInboxModel
  aiAgent: AIAgentModel
  profile: AIAgentSalesProfile
  products: SalesPromptProduct[]
  salesState: ConversationSalesState
  model: LanguageModel
  modelId: string
  provider: ReplyAIProvider
  systemPrompt: string
  messages: ModelMessage[]
  candidateText: string
  triggerMessageId?: string
  channel?: string
  startTime: number
  /** True when a system tool (e.g. `connectUserToHuman`) already executed handoff in this run. */
  handoffAlreadyExecuted?: boolean
  /**
   * Mutable handoff tracker. Prefer this over `handoffAlreadyExecuted`: it is
   * read after the model stream finishes, so a handoff executed by a tool
   * during the stream is seen even though the context was built earlier.
   */
  handoffTracker?: { executed: boolean }
  /** Custom handoff waiting-message sender (defaults to sendMessageAndWait). */
  sendHandoffMessage?: (text: string) => Promise<void>
  /** Custom judge / rewrite runners for deterministic unit testing. */
  judgeRunner?: typeof runTier2Judge
  rewriteRunner?: typeof rewriteViolatingReply
}

export type EvaluateSalesGuardResult = {
  outcome: SalesGuardOutcome
  finalText: string | null
  updatedState: ConversationSalesState
}

export async function evaluateSalesGuard(
  input: EvaluateSalesGuardInput,
): Promise<EvaluateSalesGuardResult> {
  const {
    conversation,
    contactInbox,
    aiAgent,
    profile,
    products,
    salesState,
    model,
    systemPrompt,
    messages,
    candidateText,
  } = input

  const handoffMessage = resolveSalesHandoffMessage(profile)
  const sendHandoff =
    input.sendHandoffMessage ??
    (async (text: string) => {
      await sendMessageAndWait(conversation.id, text)
    })

  const handoffAlreadyExecuted =
    input.handoffTracker?.executed ?? Boolean(input.handoffAlreadyExecuted)
  const lastCustomerMessage = extractLastCustomerText(messages)
  const tier1Initial = checkTier1Prices({
    replyText: candidateText,
    products,
  })

  const runJudge = input.judgeRunner ?? runTier2Judge
  let tier2: Tier2JudgeOutput | null = null
  try {
    tier2 = await runJudge({
      model,
      profile,
      products,
      currentStage: salesState.stage,
      lastCustomerMessage,
      candidateReply: candidateText,
    })
  } catch (error) {
    logger.warn(
      {
        err: normalizeError(error),
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        agentId: aiAgent.id,
      },
      "[sales-guard] Tier 2 judge failed or timed out; failing open to Tier 1",
    )
  }

  const customerAskedForHuman = Boolean(
    tier2?.customerAskedForHuman ||
      isCustomerAskingBotOrHuman(lastCustomerMessage),
  )
  const matchedHandoffTrigger = Boolean(tier2?.matchedHandoffTrigger)

  if (
    (customerAskedForHuman && profile.handoverOnHumanRequest) ||
    matchedHandoffTrigger
  ) {
    await sendHandoff(handoffMessage)
    if (!handoffAlreadyExecuted) {
      await handoffExecutorService.execute({
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        reason: "sales_profile_human_request",
        reopenUnansweredHumanReplyWindow: true,
        source: "automated_response",
        channel: input.channel ?? contactInbox.channel,
        inboxId: contactInbox.inboxId,
      })
    }
    await emitGuardAnalytics({
      input,
      outcome: "handoff",
      reason: "sales_profile_human_request",
    })
    return {
      outcome: "handoff",
      finalText: handoffMessage,
      updatedState: salesState,
    }
  }

  // Compute updated state from Tier 2 (or preserve on fail-open: a judge
  // timeout must neither reset nor advance the off-topic streak)
  const onTopic = tier2 ? tier2.onTopic : true
  const hasBotDisclosure = containsBotSelfDisclosure(candidateText)
  const inRole = (tier2 ? tier2.inRole : true) && !hasBotDisclosure
  let nextStreak = salesState.offTopicStreak
  if (tier2) {
    nextStreak = tier2.onTopic ? 0 : salesState.offTopicStreak + 1
  }
  const nextStage = tier2 ? tier2.stage : salesState.stage
  const mergedPitched = [
    ...new Set([
      ...salesState.pitchedProductIds,
      ...(tier2?.mentionedProductIds ?? []),
    ]),
  ]
  const updatedState: ConversationSalesState = {
    stage: nextStage,
    pitchedProductIds: mergedPitched,
    offTopicStreak: nextStreak,
    profileVersion: salesState.profileVersion,
  }

  // Persist updated sales state before any handoff/rewrite return
  try {
    await conversationService.updateSalesState({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      salesState: updatedState,
    })
  } catch (error) {
    logger.warn(
      {
        err: normalizeError(error),
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
      },
      "[sales-guard] Failed to persist conversation salesState",
    )
  }

  // 2. Off-topic streak limit handoff (skip rewrite to avoid wasted LLM latency/cost)
  if (updatedState.offTopicStreak >= profile.offTopicLimit) {
    await sendHandoff(handoffMessage)
    if (!handoffAlreadyExecuted) {
      await handoffExecutorService.execute({
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        reason: "sales_profile_off_topic",
        reopenUnansweredHumanReplyWindow: true,
        source: "automated_response",
        channel: input.channel ?? contactInbox.channel,
        inboxId: contactInbox.inboxId,
        metadata: {
          offTopicStreak: updatedState.offTopicStreak,
          offTopicLimit: profile.offTopicLimit,
        },
      })
    }
    await emitGuardAnalytics({
      input,
      outcome: "handoff",
      reason: "sales_profile_off_topic",
    })
    return {
      outcome: "handoff",
      finalText: handoffMessage,
      updatedState,
    }
  }

  // 3. Check violations and rewrite at most once
  const violations: string[] = []
  if (!tier1Initial.passed) {
    violations.push(
      `Nêu mức giá hoặc phần trăm không có trong danh mục (${tier1Initial.unmatchedValues.join(", ")})`,
    )
  }
  if (hasBotDisclosure) {
    violations.push(
      'Tự nhận là AI/bot hoặc dùng từ ngữ làm lộ bot ("bot", "AI", "trợ lý ảo", "human agent")',
    )
  } else if (!inRole) {
    violations.push("Thoát khỏi vai trò, giọng điệu hoặc đề cập chủ đề bị cấm")
  }
  if (!onTopic) {
    violations.push(
      "Trả lời lan man ngoài lề mà không dẫn dắt khách quay lại mục tiêu tư vấn",
    )
  }

  let outcome: SalesGuardOutcome = "passed"
  let finalText: string | null = candidateText

  if (violations.length > 0) {
    const runRewrite = input.rewriteRunner ?? rewriteViolatingReply
    let rewrittenText = ""
    try {
      rewrittenText = await runRewrite({
        model,
        systemPrompt,
        messages,
        candidateReply: candidateText,
        violationFeedback: violations.join("; "),
        maxOutputTokens: aiAgent.maxOutputTokens,
      })
    } catch (error) {
      logger.warn(
        {
          err: normalizeError(error),
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          agentId: aiAgent.id,
        },
        "[sales-guard] Rewrite call failed; using fallback reply",
      )
    }

    const tier1AfterRewrite = rewrittenText
      ? checkTier1Prices({ replyText: rewrittenText, products })
      : { passed: false, unmatchedValues: [] }
    const hasBotDisclosureAfterRewrite = rewrittenText
      ? containsBotSelfDisclosure(rewrittenText)
      : true

    if (
      rewrittenText &&
      tier1AfterRewrite.passed &&
      !hasBotDisclosureAfterRewrite
    ) {
      outcome = "rewritten"
      finalText = rewrittenText
    } else {
      outcome = "fallback"
      finalText = buildSalesFallbackReply({ profile, products })
      logger.info(
        {
          workspaceId: conversation.workspaceId,
          conversationId: conversation.id,
          agentId: aiAgent.id,
          violations,
        },
        "[sales-guard] Reply still failing after rewrite; using fixed fallback line",
      )
    }
  }

  await emitGuardAnalytics({
    input,
    outcome,
    violations: violations.length > 0 ? violations : undefined,
  })

  return {
    outcome,
    finalText,
    updatedState,
  }
}

async function emitGuardAnalytics(params: {
  input: EvaluateSalesGuardInput
  outcome: SalesGuardOutcome
  reason?: string
  violations?: string[]
}): Promise<void> {
  const { input, outcome, reason, violations } = params
  if (!input.triggerMessageId) {
    return
  }
  try {
    await emit("analytics:dashboard", {
      eventType: "message:bot_received",
      workspaceId: input.conversation.workspaceId,
      conversationId: input.conversation.id,
      channel: input.contactInbox.channel,
      inboxId: input.contactInbox.inboxId,
      messageId: input.triggerMessageId,
      occurredAt: new Date(),
      hasResponse: outcome !== "handoff",
      responseType: "ai_agent",
      routeType: "agent",
      result: outcome === "fallback" ? "fallback" : "success",
      aiProvider: input.provider,
      metadata: {
        latency: Date.now() - input.startTime,
        modelId: input.modelId,
        salesGuardOutcome: outcome,
        ...(reason ? { salesGuardReason: reason } : {}),
        ...(violations ? { salesGuardViolations: violations } : {}),
        triggerContext: {
          triggerSource: "worker",
          triggerHandler: "salesGuard",
          triggerType: `sales_guard_${outcome}`,
        },
      },
    })
  } catch (error) {
    logger.warn(
      {
        err: normalizeError(error),
        workspaceId: input.conversation.workspaceId,
        conversationId: input.conversation.id,
      },
      "[sales-guard] Failed to emit sales guard analytics",
    )
  }
}

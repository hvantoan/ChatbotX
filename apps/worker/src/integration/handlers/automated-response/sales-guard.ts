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
  stage: ConversationSalesStage
  mentionedProductIds: string[]
}

const tier2JudgeOutputSchema = z.object({
  onTopic: z.boolean(),
  inRole: z.boolean(),
  customerAskedForHuman: z.boolean(),
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
    const discount = Number(product.discount ?? 0)
    addValueAndUnitVariants(priceSet, price, currency)

    if (discount > 0) {
      addValueAndUnitVariants(priceSet, discount, currency)
      addValueAndUnitVariants(priceSet, Math.max(0, price - discount), currency)
      if (price > 0) {
        const pct = (discount / price) * 100
        percentSet.add(pct)
        percentSet.add(Math.round(pct))
        percentSet.add(Math.round(pct * 100) / 100)
      }
    }

    for (const variant of product.variants ?? []) {
      if (variant.isEnabled === false) {
        continue
      }
      const vPrice = Number(variant.price)
      addValueAndUnitVariants(priceSet, vPrice, currency)
      if (discount > 0) {
        addValueAndUnitVariants(
          priceSet,
          Math.max(0, vPrice - discount),
          currency,
        )
        if (vPrice > 0) {
          const vPct = (discount / vPrice) * 100
          percentSet.add(vPct)
          percentSet.add(Math.round(vPct))
          percentSet.add(Math.round(vPct * 100) / 100)
        }
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
const PERCENT_PRICING_CONTEXT_RE =
  /(?:giảm|giam|ưu\s*đãi|uu\s*dai|sale|off|discount|chiết\s*khấu|chiet\s*khau|khuyến\s*mãi|khuyen\s*mai|km|voucher|coupon|mã|giá|gia|học\s*phí|hoc\s*phi|hoàn|trả\s*góp|trả\s*trước|cọc|tiết\s*kiệm|tức|tương\s*đương|đồng|vnd|vnđ|\$|usd|\d+[.,]\d{3}|\d+k\b|\d+tr\b)/iu

// E.g. "1tr99", "1tr5", "2 triệu 5"
const VND_TRIEU_COMPOUND_RE =
  /(?:^|[^\w/])(\d+)\s*(?:tr|triệu|trieu)\s*(\d{1,3})\b/gi

// E.g. "1.99tr", "1,5 triệu", "2tr"
const VND_TRIEU_SIMPLE_RE =
  /(?:^|[^\w/])(\d+(?:[.,]\d+)?)\s*(?:tr|triệu|trieu)\b(?!\s*\d)/gi

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

  // 1. Percentages (only when adjacent to pricing/discount context so phrases
  // like "100% chính hãng" or "98% hài lòng" are not treated as prices)
  text = text.replace(
    PERCENT_RE,
    (full, numStr: string, offset: number, source: string) => {
      const windowStart = Math.max(0, offset - 45)
      const windowEnd = Math.min(source.length, offset + full.length + 25)
      const contextSlice = source.slice(windowStart, windowEnd)
      if (!PERCENT_PRICING_CONTEXT_RE.test(contextSlice)) {
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

// Self-identification only: a bare "AI" is common in product names
// ("Khóa học AI"), so it is flagged only when the reply describes itself.
const BOT_DISCLOSURE_PATTERNS: readonly RegExp[] = [
  /(?:^|[^\p{L}\p{N}_])(?:bot|chatbot)(?=$|[^\p{L}\p{N}_])/iu,
  /(?:em|tôi|mình|tớ|chúng\s+tôi|chúng\s+em)\s+(?:là|chỉ\s+là|thuộc)\s+(?:một\s+)?(?:trợ\s+lý\s+ảo\s+)?AI(?=$|[^\p{L}\p{N}_])/iu,
  /(?:đây|đó)\s+là\s+(?:một\s+)?AI(?=$|[^\p{L}\p{N}_])/iu,
  /(?:^|[^\p{L}\p{N}_])AI\s+(?:assistant|trợ\s+lý)(?=$|[^\p{L}\p{N}_])/iu,
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

const STRIP_BOT_RE =
  /(?:^|[^\p{L}\p{N}_])(?:bot|chatbot)(?=$|[^\p{L}\p{N}_])/giu
// Strip only self-identification ("em là AI", "đây là AI") so product names
// that merely contain "AI" survive into the fallback line.
const STRIP_AI_RE =
  /((?:em|tôi|mình|tớ|chúng\s+tôi|chúng\s+em|đây|đó)\s+(?:là|chỉ\s+là|thuộc)\s+(?:một\s+)?)AI/giu
const STRIP_TRO_LY_AO_RE = /trợ\s+lý\s+ảo/giu
const STRIP_HUMAN_AGENT_RE = /human\s+agent/giu
const MULTI_SPACE_RE = /\s{2,}/g

function stripBotDisclosureWords(text: string): string {
  return text
    .replace(STRIP_BOT_RE, " ")
    .replace(STRIP_AI_RE, "$1tư vấn viên")
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
    const finalPrice = Math.max(
      0,
      topProduct.price - (topProduct.discount ?? 0),
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
      "- `customerAskedForHuman`: true when the customer explicitly asks to talk to a human/real person/support agent, asks whether they are chatting with a bot/AI or a real person (e.g. 'bot à?', 'có phải người thật không?', 'đây là AI hả?'), or matches the profile's handoffTriggers.",
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
            chunks.push(el.title)
            if (el.subtitle) {
              chunks.push(el.subtitle)
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

  // 1. Human request handoff (including "bot à / người thật không")
  if (customerAskedForHuman && profile.handoverOnHumanRequest) {
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

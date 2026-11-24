// @vitest-environment node

import type { SalesPromptProduct } from "@chatbotx.io/business"
import {
  type AIAgentSalesProfile,
  type ConversationSalesState,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@chatbotx.io/database/partials"
import type {
  AIAgentModel,
  ContactInboxModel,
  ConversationModel,
} from "@chatbotx.io/database/types"
import type { LanguageModel } from "ai"
import { beforeEach, describe, expect, test, vi } from "vitest"
import scenarios from "./fixtures/sales-scenarios.json"

const { mockUpdateSalesState, mockHandoffExecute, mockSendMessageAndWait } =
  vi.hoisted(() => ({
    mockUpdateSalesState: vi.fn(),
    mockHandoffExecute: vi.fn(),
    mockSendMessageAndWait: vi.fn(),
  }))

vi.mock("@chatbotx.io/business", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@chatbotx.io/business")>()
  return {
    ...actual,
    conversationService: {
      updateSalesState: mockUpdateSalesState,
    },
  }
})

vi.mock("../src/trigger/services/handoff-executor.service", () => ({
  handoffExecutorService: {
    execute: mockHandoffExecute,
  },
}))

vi.mock("../src/integration/utils/message", () => ({
  sendMessageAndWait: mockSendMessageAndWait,
}))

vi.mock("@chatbotx.io/event-bus", () => ({
  emit: vi.fn(),
}))

const { checkTier1Prices, containsBotSelfDisclosure, evaluateSalesGuard } =
  await import("../src/integration/handlers/automated-response/sales-guard")

const catalogProducts: SalesPromptProduct[] = [
  {
    id: "3001",
    name: "Khóa IELTS Foundation",
    price: 2_500_000,
    discount: 20,
    currency: "VND",
    status: "active",
    variants: [
      {
        id: "v-online",
        combination: { "Hình thức": "Online" },
        price: 1_990_000,
        isEnabled: true,
      },
    ],
  },
  {
    id: "3002",
    name: "Khóa IELTS Intensive 6.5+",
    price: 4_000_000,
    discount: 0,
    currency: "VND",
    status: "active",
  },
  {
    id: "3003",
    name: "Luyện Speaking 1-1",
    price: 3_200_000,
    discount: 0,
    currency: "VND",
    status: "active",
  },
]

const evalProfile: AIAgentSalesProfile = {
  enabled: true,
  tone: "Thân thiện, xưng em gọi anh/chị",
  role: "Tư vấn viên khóa học tiếng Anh",
  objective: "Tư vấn và chốt đơn khóa học IELTS",
  targetProducts: [
    { productId: "3001", priority: 1, pitchNote: "Ưu tiên cho người mất gốc" },
    {
      productId: "3002",
      priority: 2,
      pitchNote: "Cho học viên đã có nền tảng",
    },
    { productId: "3003", priority: 3, pitchNote: "Kèm riêng kỹ năng nói" },
  ],
  forbiddenTopics: ["Chính trị", "Nói xấu đối thủ"],
  offTopicLimit: 3,
  handoverOnHumanRequest: true,
  handoffMessage: DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
  handoffTriggers:
    "Khách đồng ý mua, muốn thanh toán, xin giảm giá ngoài chính sách, yêu cầu VIP 1:1",
}

const fakeConversation = {
  id: "conv-eval",
  workspaceId: "ws-eval",
  contactId: "contact-eval",
} as unknown as ConversationModel

const fakeContactInbox = {
  id: "ci-eval",
  inboxId: "inbox-eval",
  channel: "webchat",
} as unknown as ContactInboxModel

const fakeAgent = {
  id: "agent-eval",
  workspaceId: "ws-eval",
  maxOutputTokens: 500,
} as unknown as AIAgentModel

const fakeModel = {} as unknown as LanguageModel

function detectFirstPitchedProductId(text: string): string | null {
  const positions: Array<{ id: string; index: number }> = []
  for (const product of catalogProducts) {
    const idx = text.indexOf(product.name)
    if (idx !== -1) {
      positions.push({ id: product.id, index: idx })
    }
  }
  positions.sort((a, b) => a.index - b.index)
  return positions[0]?.id ?? null
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateSalesState.mockResolvedValue(undefined)
  mockHandoffExecute.mockResolvedValue({ status: "handedOff" })
  mockSendMessageAndWait.mockResolvedValue(undefined)
})

describe("Sales Persona 30-Scenario Benchmark Evaluation", () => {
  test("meets all quantitative release gates (including 0 bot-disclosure terms and 100% handoff waiting message) across the Vietnamese scenarios", async () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(30)

    let inventedPricesDelivered = 0
    let botDisclosuresDelivered = 0
    let genericInquiryCount = 0
    let genericInquiryPriority1FirstCount = 0
    let onTopicInRolePassCount = 0
    let nonHandoffScenarioCount = 0
    let handoffTriggerTotal = 0
    let handoffTriggerSuccess = 0
    const latenciesMs: number[] = []

    for (const scenario of scenarios) {
      const startedAt = performance.now()
      const initialState: ConversationSalesState = {
        stage: "discover",
        pitchedProductIds: [],
        offTopicStreak: scenario.initialOffTopicStreak ?? 0,
        profileVersion: 1,
      }

      const result = await evaluateSalesGuard({
        conversation: fakeConversation,
        contactInbox: fakeContactInbox,
        aiAgent: fakeAgent,
        profile: evalProfile,
        products: catalogProducts,
        salesState: initialState,
        model: fakeModel,
        modelId: "gpt-5.4-mini",
        provider: "openai",
        systemPrompt: "System",
        messages: [{ role: "user", content: scenario.customerMessage }],
        candidateText: scenario.candidateReply,
        triggerMessageId: scenario.id,
        startTime: Date.now(),
        judgeRunner: async () => ({
          onTopic: scenario.expected.onTopic,
          inRole: scenario.expected.inRole,
          customerAskedForHuman: scenario.expected.customerAskedForHuman,
          matchedHandoffTrigger: false,
          stage: "pitch",
          mentionedProductIds: scenario.expected.firstPitchedProductId
            ? [scenario.expected.firstPitchedProductId]
            : [],
        }),
        rewriteRunner: async () =>
          "rewrittenReply" in scenario &&
          typeof scenario.rewrittenReply === "string"
            ? scenario.rewrittenReply
            : "",
      })

      latenciesMs.push(performance.now() - startedAt)

      expect(result.outcome).toBe(scenario.expected.guardOutcome)

      // Gate 1: Zero invented prices and zero bot-disclosure terms ("bot", "AI", "trợ lý ảo", "human agent") in delivered replies
      if (result.finalText) {
        const tier1Final = checkTier1Prices({
          replyText: result.finalText,
          products: catalogProducts,
        })
        if (!tier1Final.passed) {
          inventedPricesDelivered += 1
        }
        if (containsBotSelfDisclosure(result.finalText)) {
          botDisclosuresDelivered += 1
        }
      }

      // Gate 2: With no product named by customer (generic inquiry), first product pitched is priority 1 >= 80%
      if (scenario.category === "generic_inquiry" && result.finalText) {
        genericInquiryCount += 1
        const firstPitched = detectFirstPitchedProductId(result.finalText)
        if (firstPitched === "3001") {
          genericInquiryPriority1FirstCount += 1
        }
      }

      // Gate 3: On-topic & in-role after guard >= 90%
      if (result.outcome !== "handoff" && result.finalText) {
        nonHandoffScenarioCount += 1
        if (
          result.finalText.includes("Khóa IELTS") ||
          result.finalText.includes("Luyện Speaking")
        ) {
          onTopicInRolePassCount += 1
        }
      }

      // Gate 4: Handoff at streak limit or human request = 100%, and always delivers handoffMessage
      if (
        scenario.category === "off_topic_streak_3" ||
        scenario.category === "human_request"
      ) {
        handoffTriggerTotal += 1
        if (
          result.outcome === "handoff" &&
          result.finalText === DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE
        ) {
          handoffTriggerSuccess += 1
        }
      }
    }

    const priority1Ratio =
      genericInquiryPriority1FirstCount / Math.max(1, genericInquiryCount)
    const onTopicInRoleRatio =
      onTopicInRolePassCount / Math.max(1, nonHandoffScenarioCount)
    const handoffRatio =
      handoffTriggerSuccess / Math.max(1, handoffTriggerTotal)

    const sortedLatencies = [...latenciesMs].sort((a, b) => a - b)
    const p95Index = Math.min(
      sortedLatencies.length - 1,
      Math.floor(sortedLatencies.length * 0.95),
    )
    const p95LatencyMs = sortedLatencies[p95Index] ?? 0

    expect(inventedPricesDelivered).toBe(0)
    expect(botDisclosuresDelivered).toBe(0)
    expect(priority1Ratio).toBeGreaterThanOrEqual(0.8)
    expect(onTopicInRoleRatio).toBeGreaterThanOrEqual(0.9)
    expect(handoffRatio).toBe(1)
    expect(p95LatencyMs).toBeLessThanOrEqual(2000)
  })
})

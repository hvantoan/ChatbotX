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

const {
  mockUpdateSalesState,
  mockHandoffExecute,
  mockSendMessageAndWait,
  mockEmit,
} = vi.hoisted(() => ({
  mockUpdateSalesState: vi.fn(),
  mockHandoffExecute: vi.fn(),
  mockSendMessageAndWait: vi.fn(),
  mockEmit: vi.fn(),
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
  emit: mockEmit,
}))

const {
  buildSalesFallbackReply,
  buildAllowedPriceAndPercentSets,
  checkTier1Prices,
  containsBotSelfDisclosure,
  evaluateSalesGuard,
  extractMoneyAndPercentTokens,
  extractRichResponseTexts,
  isCustomerAskingBotOrHuman,
  resolveSalesHandoffMessage,
} = await import("../src/integration/handlers/automated-response/sales-guard")

const products: SalesPromptProduct[] = [
  {
    id: "3001",
    name: "Khóa IELTS Foundation",
    price: 2_500_000,
    discount: 20,
    currency: "VND",
    status: "active",
    variants: [
      {
        id: "v1",
        combination: { "Hình thức": "Online" },
        price: 1_990_000,
        isEnabled: true,
      },
    ],
  },
  {
    id: "3002",
    name: "Ebook Tiếng Anh",
    price: 49,
    discount: 0,
    currency: "USD",
    status: "active",
  },
]

const profile: AIAgentSalesProfile = {
  enabled: true,
  tone: "Thân thiện, xưng em gọi anh/chị",
  role: "Tư vấn viên khóa học",
  objective: "Chốt đơn khóa IELTS Foundation",
  targetProducts: [{ productId: "3001", priority: 1 }],
  forbiddenTopics: ["Chính trị"],
  offTopicLimit: 3,
  handoverOnHumanRequest: true,
  handoffMessage: DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
  handoffTriggers:
    "Khách đồng ý mua, muốn thanh toán, xin giảm giá ngoài chính sách, yêu cầu VIP 1:1",
}

const initialState: ConversationSalesState = {
  stage: "discover",
  pitchedProductIds: [],
  offTopicStreak: 0,
  profileVersion: 1,
}

const fakeConversation = {
  id: "conv-1",
  workspaceId: "ws-1",
  contactId: "contact-1",
} as unknown as ConversationModel

const fakeContactInbox = {
  id: "ci-1",
  inboxId: "inbox-1",
  channel: "messenger",
} as unknown as ContactInboxModel

const fakeAgent = {
  id: "agent-1",
  workspaceId: "ws-1",
  maxOutputTokens: 500,
} as unknown as AIAgentModel

const fakeModel = {} as unknown as LanguageModel

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateSalesState.mockResolvedValue(undefined)
  mockHandoffExecute.mockResolvedValue({ status: "handedOff" })
  mockSendMessageAndWait.mockResolvedValue(undefined)
})

describe("Tier 1 price and percent extraction & verification", () => {
  test("parses VND and USD formats and percentages accurately", () => {
    const extracted = extractMoneyAndPercentTokens(
      "Khóa học giá gốc 2.500.000đ, giảm 20% (tức 500k), chỉ còn 2tr hoặc bản Online 1tr99 và Ebook $49.",
    )
    expect(extracted.prices).toEqual(
      expect.arrayContaining([2_500_000, 500_000, 2_000_000, 1_990_000, 49]),
    )
    expect(extracted.percents).toEqual([20])
  })

  test("passes real price, discounted price, variant price and discount percentage", () => {
    const res = checkTier1Prices({
      replyText:
        "Dạ Khóa IELTS Foundation có giá gốc 2.500.000đ, đang giảm 500.000đ (20%) còn 2.000.000đ. Bản Online là 1.990.000đ và Ebook là $49 ạ!",
      products,
    })
    expect(res.passed).toBe(true)
    expect(res.unmatchedValues).toEqual([])
  })

  test("extracts discounts quoted as price(percent) or 'lên đến N%'", () => {
    expect(
      extractMoneyAndPercentTokens("Giá 2.500.000đ (50%)").percents,
    ).toEqual([50])
    expect(
      extractMoneyAndPercentTokens("giảm giá lên đến 50%").percents,
    ).toEqual([50])
    expect(
      extractMoneyAndPercentTokens("Giá 2.500.000đ (100% online)").percents,
    ).toEqual([])
    expect(
      extractMoneyAndPercentTokens("Giá 2.500.000đ (50% giảm)").percents,
    ).toEqual([50])
    expect(
      extractMoneyAndPercentTokens("Cotton 100%\nGiảm giá 20%").percents,
    ).toEqual([20])
    expect(extractMoneyAndPercentTokens("20%\u00A0off today").percents).toEqual(
      [20],
    )
    expect(
      extractMoneyAndPercentTokens("20% off-peak discount").percents,
    ).toEqual([20])
    expect(
      extractMoneyAndPercentTokens("20% off-grid operation").percents,
    ).toEqual([])
    expect(
      extractMoneyAndPercentTokens("100% off-grid sale bundle").percents,
    ).toEqual([])
    expect(
      extractMoneyAndPercentTokens("20% off-hours discount").percents,
    ).toEqual([20])
    expect(
      extractMoneyAndPercentTokens("100% Off-Grid Discount Solar Kit").percents,
    ).toEqual([])
    expect(
      extractMoneyAndPercentTokens("30% off-invoice discount").percents,
    ).toEqual([30])
    expect(
      extractMoneyAndPercentTokens("100% off-lease discount laptops").percents,
    ).toEqual([])
    expect(
      extractMoneyAndPercentTokens("20% off-MSRP discount").percents,
    ).toEqual([20])
    expect(
      extractMoneyAndPercentTokens("100% off-price sale merchandise").percents,
    ).toEqual([])
  })

  test("keeps business names like 'đây là Botanic Spa' in handoff messages", () => {
    expect(
      resolveSalesHandoffMessage({
        handoffMessage:
          "Em sẽ chuyển anh/chị sang nhân viên, đây là Botanic Spa ạ",
      }),
    ).toBe("Em sẽ chuyển anh/chị sang nhân viên, đây là Botanic Spa ạ")
    expect(
      resolveSalesHandoffMessage({ handoffMessage: "em là AI, xin lỗi" }),
    ).toBe("em là tư vấn viên, xin lỗi")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "I am a chatbot for this store.",
      }),
    ).toBe("I am a tư vấn viên for this store.")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "This is AI Solutions support, please wait.",
      }),
    ).toBe("This is AI Solutions support, please wait.")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "This is an AI assistant, please wait.",
      }),
    ).toBe("This is an tư vấn viên, please wait.")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "This is AI. Please wait while I connect you.",
      }),
    ).toBe("This is tư vấn viên. Please wait while I connect you.")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "This is AI.com support. Please wait.",
      }),
    ).toBe("This is AI.com support. Please wait.")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "This is AI!👋 Please wait.",
      }),
    ).toBe("This is tư vấn viên!👋 Please wait.")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "This is AI:101 support. Please wait.",
      }),
    ).toBe("This is AI:101 support. Please wait.")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "This is AI,please wait.",
      }),
    ).toBe("This is tư vấn viên,please wait.")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "This is AI:１０１ support. Please wait.",
      }),
    ).toBe("This is AI:１０１ support. Please wait.")
    expect(
      resolveSalesHandoffMessage({
        handoffMessage: "This is AI:Ⅲ support. Please wait.",
      }),
    ).toBe("This is AI:Ⅲ support. Please wait.")
  })

  test("blocks an invented price or percentage with reason invented_price", () => {
    const resPrice = checkTier1Prices({
      replyText: "Dạ khóa học bên em chỉ có 990.000đ thôi ạ!",
      products,
    })
    expect(resPrice.passed).toBe(false)
    expect(resPrice.reason).toBe("invented_price")
    expect(resPrice.unmatchedValues).toContain(990_000)

    const resPercent = checkTier1Prices({
      replyText: "Bên em đang giảm sâu 50% cho khóa học này ạ!",
      products,
    })
    expect(resPercent.passed).toBe(false)
    expect(resPercent.reason).toBe("invented_price")
    expect(resPercent.unmatchedValues).toContain(50)
  })

  test("rounds discounted prices to the currency unit (no fractional cents)", () => {
    const usdProducts: SalesPromptProduct[] = [
      {
        id: "4001",
        name: "Ebook Premium",
        price: 19.99,
        discount: 20,
        currency: "USD",
        status: "active",
      },
    ]
    const sets = buildAllowedPriceAndPercentSets(usdProducts)
    expect(sets.allowedPrices).toContain(4)
    expect(sets.allowedPrices).toContain(15.99)
    expect(sets.allowedPrices).not.toContain(15.989_999_999_999_998)
    const res = checkTier1Prices({
      replyText: "Dạ Ebook Premium chỉ còn $15.99 sau khi giảm 20% ạ!",
      products: usdProducts,
    })
    expect(res.passed).toBe(true)
  })

  test("ignores non-pricing percentages like 100% chính hãng or 98% hài lòng", () => {
    const res = checkTier1Prices({
      replyText:
        "Khóa học bên em 100% chính hãng, lộ trình 100% online và 98% học viên hài lòng ạ!",
      products,
    })
    expect(res.passed).toBe(true)
    expect(res.unmatchedValues).toEqual([])
  })

  test("does not treat a reassurance percentage next to a price as an invented discount", () => {
    const res = checkTier1Prices({
      replyText:
        "Học phí 2.500.000đ, cam kết 100% đầu ra và 98% học viên hài lòng ạ!",
      products,
    })
    expect(res.passed).toBe(true)
    expect(res.unmatchedValues).toEqual([])
  })
})

describe("evaluateSalesGuard decision pipeline", () => {
  test("rewrites at most once when Tier 1 fails on an invented price, and passes if rewrite fixes it", async () => {
    const judgeRunner = vi.fn().mockResolvedValue({
      onTopic: true,
      inRole: true,
      customerAskedForHuman: false,
      matchedHandoffTrigger: false,
      stage: "pitch",
      mentionedProductIds: ["3001"],
    })
    const rewriteRunner = vi
      .fn()
      .mockResolvedValue(
        "Dạ em xin lỗi, Khóa IELTS Foundation có giá sau giảm là 2.000.000đ ạ.",
      )

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile,
      products,
      salesState: initialState,
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Giá bao nhiêu em?" }],
      candidateText: "Dạ khóa học giá 990.000đ ạ.",
      triggerMessageId: "msg-1",
      startTime: Date.now(),
      judgeRunner,
      rewriteRunner,
    })

    expect(rewriteRunner).toHaveBeenCalledTimes(1)
    expect(result.outcome).toBe("rewritten")
    expect(result.finalText).toBe(
      "Dạ em xin lỗi, Khóa IELTS Foundation có giá sau giảm là 2.000.000đ ạ.",
    )
    expect(result.updatedState).toEqual({
      stage: "pitch",
      pitchedProductIds: ["3001"],
      offTopicStreak: 0,
      profileVersion: 1,
    })
    expect(mockUpdateSalesState).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      conversationId: "conv-1",
      salesState: result.updatedState,
    })
  })

  test("falls back to fixed profile line when rewrite still contains an invented price", async () => {
    const judgeRunner = vi.fn().mockResolvedValue({
      onTopic: true,
      inRole: true,
      customerAskedForHuman: false,
      matchedHandoffTrigger: false,
      stage: "pitch",
      mentionedProductIds: ["3001"],
    })
    const rewriteRunner = vi
      .fn()
      .mockResolvedValue("Dạ giá ưu đãi chỉ 800.000đ thôi ạ.")

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile,
      products,
      salesState: initialState,
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Giảm thêm đi shop" }],
      candidateText: "Dạ em giảm còn 700.000đ nhé.",
      triggerMessageId: "msg-2",
      startTime: Date.now(),
      judgeRunner,
      rewriteRunner,
    })

    expect(rewriteRunner).toHaveBeenCalledTimes(1)
    expect(result.outcome).toBe("fallback")
    expect(result.finalText).toContain(
      "Dạ em xin phép quay lại nội dung tư vấn",
    )
    expect(result.finalText).toContain("2000000 VND")
  })

  test("sends handoffMessage BEFORE calling handoffExecutorService on human request", async () => {
    const callOrder: string[] = []
    mockSendMessageAndWait.mockImplementation(() => {
      callOrder.push("sendMessageAndWait")
      return Promise.resolve()
    })
    mockHandoffExecute.mockImplementation(() => {
      callOrder.push("handoffExecute")
      return Promise.resolve({ status: "handedOff" })
    })

    const judgeRunner = vi.fn().mockResolvedValue({
      onTopic: true,
      inRole: true,
      customerAskedForHuman: true,
      matchedHandoffTrigger: false,
      stage: "discover",
      mentionedProductIds: [],
    })

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile,
      products,
      salesState: initialState,
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [
        { role: "user", content: "Cho anh gặp nhân viên tư vấn thật" },
      ],
      candidateText: "Dạ để em hỗ trợ anh ạ.",
      triggerMessageId: "msg-3",
      startTime: Date.now(),
      judgeRunner,
    })

    expect(result.outcome).toBe("handoff")
    expect(result.finalText).toBe(DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE)
    expect(mockSendMessageAndWait).toHaveBeenCalledWith(
      "conv-1",
      DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
    )
    expect(callOrder).toEqual(["sendMessageAndWait", "handoffExecute"])
    expect(mockHandoffExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        conversationId: "conv-1",
        contactId: "contact-1",
        reason: "sales_profile_human_request",
      }),
    )
  })

  test("sends handoffMessage BEFORE calling handoffExecutorService when offTopicStreak reaches offTopicLimit", async () => {
    const callOrder: string[] = []
    mockSendMessageAndWait.mockImplementation(() => {
      callOrder.push("sendMessageAndWait")
      return Promise.resolve()
    })
    mockHandoffExecute.mockImplementation(() => {
      callOrder.push("handoffExecute")
      return Promise.resolve({ status: "handedOff" })
    })

    const judgeRunner = vi.fn().mockResolvedValue({
      onTopic: false,
      inRole: true,
      customerAskedForHuman: false,
      matchedHandoffTrigger: false,
      stage: "discover",
      mentionedProductIds: [],
    })
    const rewriteRunner = vi
      .fn()
      .mockResolvedValue("Dạ thời tiết hôm nay đẹp ạ, mình xem khóa IELTS nhé!")

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile,
      products,
      salesState: {
        ...initialState,
        offTopicStreak: 2, // 2 + 1 = 3 >= offTopicLimit (3)
      },
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Hôm nay trời mưa không?" }],
      candidateText: "Trời nắng lắm anh ơi.",
      triggerMessageId: "msg-4",
      startTime: Date.now(),
      judgeRunner,
      rewriteRunner,
    })

    expect(result.outcome).toBe("handoff")
    expect(result.finalText).toBe(DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE)
    expect(result.updatedState.offTopicStreak).toBe(3)
    expect(rewriteRunner).not.toHaveBeenCalled()
    expect(mockSendMessageAndWait).toHaveBeenCalledWith(
      "conv-1",
      DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
    )
    expect(callOrder).toEqual(["sendMessageAndWait", "handoffExecute"])
    expect(mockHandoffExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        conversationId: "conv-1",
        reason: "sales_profile_off_topic",
      }),
    )
  })

  test("skips duplicate handoffExecutorService.execute when handoffAlreadyExecuted is true", async () => {
    const judgeRunner = vi.fn().mockResolvedValue({
      onTopic: true,
      inRole: true,
      customerAskedForHuman: true,
      matchedHandoffTrigger: false,
      stage: "discover",
      mentionedProductIds: [],
    })

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile,
      products,
      salesState: initialState,
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Cho anh gặp tư vấn viên" }],
      candidateText: "Dạ để em chuyển tư vấn viên ạ.",
      triggerMessageId: "msg-dup-handoff",
      startTime: Date.now(),
      handoffAlreadyExecuted: true,
      judgeRunner,
    })

    expect(result.outcome).toBe("handoff")
    expect(mockSendMessageAndWait).toHaveBeenCalledWith(
      "conv-1",
      DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
    )
    expect(mockHandoffExecute).not.toHaveBeenCalled()
  })

  test("reads the mutable handoff tracker so a tool handoff during the stream is not repeated", async () => {
    const judgeRunner = vi.fn().mockResolvedValue({
      onTopic: true,
      inRole: true,
      customerAskedForHuman: true,
      matchedHandoffTrigger: false,
      stage: "discover",
      mentionedProductIds: [],
    })
    // The context object is created before the stream runs; the tool flips it.
    const handoffTracker = { executed: true }

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile,
      products,
      salesState: initialState,
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Cho anh gặp tư vấn viên" }],
      candidateText: "Dạ để em chuyển tư vấn viên ạ.",
      triggerMessageId: "msg-tracker-handoff",
      startTime: Date.now(),
      handoffTracker,
      judgeRunner,
    })

    expect(result.outcome).toBe("handoff")
    expect(mockHandoffExecute).not.toHaveBeenCalled()
  })

  test("treats 'bot à / người thật không' questions as customerAskedForHuman and hands off with handoffMessage", async () => {
    expect(isCustomerAskingBotOrHuman("Em là bot à?")).toBe(true)
    expect(isCustomerAskingBotOrHuman("Có phải người thật không vậy?")).toBe(
      true,
    )

    const judgeRunner = vi.fn().mockResolvedValue({
      onTopic: true,
      inRole: true,
      customerAskedForHuman: false,
      matchedHandoffTrigger: false,
      stage: "discover",
      mentionedProductIds: [],
    })

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile,
      products,
      salesState: initialState,
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [
        { role: "user", content: "Em là bot à hay người thật không?" },
      ],
      candidateText: "Dạ em là tư vấn viên khóa học tiếng Anh ạ.",
      triggerMessageId: "msg-bot-question",
      startTime: Date.now(),
      judgeRunner,
    })

    expect(result.outcome).toBe("handoff")
    expect(result.finalText).toBe(DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE)
    expect(mockSendMessageAndWait).toHaveBeenCalledWith(
      "conv-1",
      DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
    )
    expect(mockHandoffExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "sales_profile_human_request",
      }),
    )
  })

  test("hands off on a handoffTrigger match even when handoverOnHumanRequest is off", async () => {
    const judgeRunner = vi.fn().mockResolvedValue({
      onTopic: true,
      inRole: true,
      customerAskedForHuman: false,
      matchedHandoffTrigger: true,
      stage: "close",
      mentionedProductIds: [],
    })

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile: { ...profile, handoverOnHumanRequest: false },
      products,
      salesState: initialState,
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Ok em chốt đơn nhé" }],
      candidateText: "Dạ em chuyển anh sang tư vấn viên ngay ạ.",
      triggerMessageId: "msg-trigger-handoff",
      startTime: Date.now(),
      judgeRunner,
    })

    expect(result.outcome).toBe("handoff")
    expect(mockHandoffExecute).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "sales_profile_human_request" }),
    )
  })

  test("flags inRole violation and rewrites when candidate reply self-identifies as AI or bot", async () => {
    expect(
      containsBotSelfDisclosure("Dạ em là trợ lý ảo AI của trung tâm ạ."),
    ).toBe(true)
    expect(
      containsBotSelfDisclosure("I am connecting you to a human agent."),
    ).toBe(true)
    expect(
      containsBotSelfDisclosure(
        "Dạ Khóa IELTS Foundation phù hợp cho bất kỳ ai muốn học từ đầu ạ.",
      ),
    ).toBe(false)
    expect(containsBotSelfDisclosure("Dạ Khóa học AI của bên em ạ.")).toBe(
      false,
    )
    expect(
      containsBotSelfDisclosure("Dạ bên em có gói Chatbot Builder ạ."),
    ).toBe(false)
    expect(containsBotSelfDisclosure("Dạ em là AI tư vấn ạ.")).toBe(true)
    expect(containsBotSelfDisclosure("I'm a chatbot for this store.")).toBe(
      true,
    )
    expect(
      containsBotSelfDisclosure("This is an AI assistant, how can I help?"),
    ).toBe(true)
    expect(containsBotSelfDisclosure("This is AI Essentials.")).toBe(false)
    expect(containsBotSelfDisclosure("This is AI. How can I help?")).toBe(true)
    expect(containsBotSelfDisclosure("This is AI.com support.")).toBe(false)
    expect(containsBotSelfDisclosure("This is AI!👋")).toBe(true)
    expect(containsBotSelfDisclosure("Dạ em là bot của trung tâm ạ.")).toBe(
      true,
    )

    const judgeRunner = vi.fn().mockResolvedValue({
      onTopic: true,
      inRole: true,
      customerAskedForHuman: false,
      matchedHandoffTrigger: false,
      stage: "pitch",
      mentionedProductIds: ["3001"],
    })
    const rewriteRunner = vi
      .fn()
      .mockResolvedValue(
        "Dạ em xin giới thiệu Khóa IELTS Foundation học phí 2.000.000đ phù hợp cho anh/chị ạ!",
      )

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile,
      products,
      salesState: initialState,
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Tư vấn khóa học giúp anh" }],
      candidateText:
        "Dạ em là bot AI trợ lý ảo, em giới thiệu Khóa IELTS Foundation 2.000.000đ ạ.",
      triggerMessageId: "msg-self-disclosure",
      startTime: Date.now(),
      judgeRunner,
      rewriteRunner,
    })

    expect(rewriteRunner).toHaveBeenCalledTimes(1)
    expect(result.outcome).toBe("rewritten")
    expect(containsBotSelfDisclosure(result.finalText ?? "")).toBe(false)

    const fallbackText = buildSalesFallbackReply({ profile, products })
    expect(containsBotSelfDisclosure(fallbackText)).toBe(false)
    expect(fallbackText).toContain("Dạ em")
  })

  test("fails open to Tier 1 when Tier 2 judge times out or throws", async () => {
    const judgeRunner = vi
      .fn()
      .mockRejectedValue(new Error("AbortError: The operation was aborted"))

    const result = await evaluateSalesGuard({
      conversation: fakeConversation,
      contactInbox: fakeContactInbox,
      aiAgent: fakeAgent,
      profile,
      products,
      salesState: { ...initialState, offTopicStreak: 2 },
      model: fakeModel,
      modelId: "gpt-5.4-mini",
      provider: "openai",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Tư vấn khóa học giúp anh" }],
      candidateText:
        "Dạ Khóa IELTS Foundation bên em giá sau giảm là 2.000.000đ ạ!",
      triggerMessageId: "msg-5",
      startTime: Date.now(),
      judgeRunner,
    })

    expect(result.outcome).toBe("passed")
    expect(result.finalText).toBe(
      "Dạ Khóa IELTS Foundation bên em giá sau giảm là 2.000.000đ ạ!",
    )
    // A judge timeout must neither reset nor advance the off-topic streak.
    expect(result.updatedState.offTopicStreak).toBe(2)
    expect(result.updatedState.stage).toBe("discover")
  })
})

describe("extractRichResponseTexts", () => {
  test("includes quick-reply and template button titles so their prices are verified", () => {
    const text = extractRichResponseTexts({
      actions: [],
      messages: [
        {
          message: {
            text: "Mua 199k nhé",
            quick_replies: [{ content_type: "text", title: "Mua ngay 99k" }],
          },
        },
        {
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "generic",
                elements: [
                  {
                    title: "Khóa học",
                    buttons: [
                      {
                        title: "Đăng ký 149k",
                        type: "postback",
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
    })

    expect(text).toContain("Mua ngay 99k")
    expect(text).toContain("Đăng ký 149k")
  })

  test("joins a card's title and subtitle on one line so split discounts parse", () => {
    const text = extractRichResponseTexts({
      messages: [
        {
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "generic",
                elements: [
                  {
                    title: "20%",
                    subtitle: "Off for new customers",
                    buttons: [],
                  },
                  {
                    title: "Up to 20%",
                    subtitle: "off selected items",
                    buttons: [],
                  },
                  {
                    title: "Up to 100%",
                    subtitle: "off-grid operation",
                    buttons: [],
                  },
                  {
                    title: "20%",
                    subtitle: "off-peak discount",
                    buttons: [],
                  },
                ],
              },
            },
          },
        },
      ],
    })

    expect(text).toBe(
      "20% Off for new customers\nUp to 20% off selected items\nUp to 100%\noff-grid operation\n20% off-peak discount",
    )
    expect(extractMoneyAndPercentTokens(text).percents).toEqual([20, 20, 20])
  })

  test("keeps title/subtitle boundaries so warranty months stay out of prices", () => {
    const text = extractRichResponseTexts({
      messages: [
        {
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "generic",
                elements: [
                  {
                    title: "Giá 2 triệu",
                    subtitle: "24 tháng bảo hành",
                    buttons: [],
                  },
                  {
                    title: "Cotton 100%",
                    subtitle: "Discount applied at checkout",
                    buttons: [],
                  },
                ],
              },
            },
          },
        },
      ],
    })

    expect(extractMoneyAndPercentTokens(text).prices).toEqual([2_000_000])
    expect(extractMoneyAndPercentTokens(text).percents).toEqual([])
  })
})

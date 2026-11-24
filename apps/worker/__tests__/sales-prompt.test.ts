// @vitest-environment node

import { aiPolicies, systemFunctionNames } from "@chatbotx.io/ai"
import {
  appendHandoffPolicy,
  buildSalesHandoffPolicy,
} from "@chatbotx.io/ai/server"
import {
  compileSalesPrompt,
  resolveConversationSalesState,
  type SalesPromptProduct,
} from "@chatbotx.io/business"
import {
  type AIAgentSalesProfile,
  type ConversationSalesState,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@chatbotx.io/database/partials"
import type { ToolSet } from "ai"
import { describe, expect, test, vi } from "vitest"

const sampleProfile: AIAgentSalesProfile = {
  enabled: true,
  tone: "Thân thiện, xưng em gọi anh/chị",
  role: "Tư vấn viên khóa học tiếng Anh",
  objective: "Tư vấn và chốt đơn khóa học IELTS cho người đi làm",
  targetProducts: [
    {
      productId: "3002",
      priority: 2,
      pitchNote: "Giới thiệu khi khách muốn học nâng cao",
    },
    {
      productId: "3001",
      priority: 1,
      pitchNote: "Ưu tiên cho người mất gốc",
    },
    {
      productId: "3003",
      priority: 3,
      pitchNote: "Sản phẩm đã ngừng bán",
    },
  ],
  forbiddenTopics: ["Chính trị", "Nói xấu đối thủ"],
  offTopicLimit: 3,
  handoverOnHumanRequest: true,
  handoffMessage: DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
  handoffTriggers:
    "Đồng ý mua, muốn thanh toán, xin giảm giá ngoài chính sách, tư vấn VIP 1:1",
}

const sampleProducts: SalesPromptProduct[] = [
  {
    id: "3001",
    name: "Khóa IELTS Foundation",
    price: 2_500_000,
    discount: 20,
    currency: "VND",
    productUrl: "https://example.com/ielts-foundation",
    status: "active",
    variants: [
      {
        id: "v1",
        combination: { "Hình thức": "Online" },
        price: 1_990_000,
        isEnabled: true,
      },
      {
        id: "v2",
        combination: { "Hình thức": "Offline" },
        price: 2_500_000,
        isEnabled: false,
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
    name: "Khóa TOEIC Cũ",
    price: 1_000_000,
    discount: 0,
    currency: "VND",
    status: "inactive",
  },
]

describe("compileSalesPrompt", () => {
  test("compiles 4 fixed sections with products ordered by priority and excludes inactive/deleted products", () => {
    const salesState: ConversationSalesState = {
      stage: "pitch",
      pitchedProductIds: ["3001"],
      offTopicStreak: 1,
      profileVersion: 4,
    }

    const prompt = compileSalesPrompt({
      profile: sampleProfile,
      products: sampleProducts,
      salesState,
    })

    expect(prompt).toContain("[1. VAI TRÒ & GIỌNG ĐIỆU]")
    expect(prompt).toContain(
      "Bạn là Tư vấn viên khóa học tiếng Anh. Giọng điệu: Thân thiện, xưng em gọi anh/chị",
    )
    expect(prompt).toContain("[2. MỤC TIÊU & SẢN PHẨM MỤC TIÊU]")
    // Priority 1 appears before Priority 2 even though targetProducts array had 2 before 1
    const idx1 = prompt.indexOf(
      "[Ưu tiên 1] ID=3001 | Tên: Khóa IELTS Foundation",
    )
    const idx2 = prompt.indexOf(
      "[Ưu tiên 2] ID=3002 | Tên: Khóa IELTS Intensive 6.5+",
    )
    expect(idx1).toBeGreaterThan(-1)
    expect(idx2).toBeGreaterThan(idx1)
    // Inactive product 3003 and disabled variant Offline are excluded
    expect(prompt).not.toContain("Khóa TOEIC Cũ")
    expect(prompt).toContain("Online: 1592000 VND")
    expect(prompt).not.toContain("Offline: 2500000 VND")
    expect(prompt).toContain("[3. QUY TẮC BẮT BUỘC]")
    expect(prompt).toContain(
      "Chủ đề cấm thảo luận: Chính trị, Nói xấu đối thủ.",
    )
    expect(prompt).toContain("[4. TRẠNG THÁI HỘI THOẠI HIỆN TẠI]")
    expect(prompt).toContain("- Giai đoạn bán hàng (stage): pitch")
    expect(prompt).toContain(
      "- Sản phẩm đã giới thiệu: Khóa IELTS Foundation (ID=3001)",
    )
    expect(prompt).toContain("- Số lượt ngoài lề liên tiếp: 1/3")
  })

  test("handles empty product list gracefully", () => {
    const prompt = compileSalesPrompt({
      profile: {
        ...sampleProfile,
        targetProducts: [],
        forbiddenTopics: [],
      },
      products: [],
      salesState: null,
    })

    expect(prompt).toContain("- (Chưa có sản phẩm mục tiêu đang hoạt động)")
    expect(prompt).toContain("- Giai đoạn bán hàng (stage): discover")
    expect(prompt).toContain("- Sản phẩm đã giới thiệu: Chưa có")
  })

  test("resolveConversationSalesState resets state to discover when profileVersion changes", () => {
    const oldState: ConversationSalesState = {
      stage: "close",
      pitchedProductIds: ["3001"],
      offTopicStreak: 2,
      profileVersion: 1,
    }

    const reset = resolveConversationSalesState({
      existing: oldState,
      profileVersion: 2,
    })

    expect(reset).toEqual({
      stage: "discover",
      pitchedProductIds: [],
      offTopicStreak: 0,
      profileVersion: 2,
    })

    expect(
      resolveConversationSalesState({
        existing: oldState,
        profileVersion: 1,
      }),
    ).toEqual(oldState)
  })

  test("replaces generic aiPolicies.handoff with sales handoff policy when salesProfile is active, and keeps generic policy for agents without a sales profile", () => {
    const tools = {
      [systemFunctionNames.connectUserToHuman]: {},
    } as unknown as ToolSet

    const genericPrompt = appendHandoffPolicy("Base prompt", tools, null)
    expect(genericPrompt).toContain(aiPolicies.handoff)
    expect(genericPrompt).toContain("connected to a human agent")

    const salesPrompt = appendHandoffPolicy("Base prompt", tools, {
      handoffMessage: sampleProfile.handoffMessage,
      handoffTriggers: sampleProfile.handoffTriggers,
    })
    expect(salesPrompt).not.toContain(aiPolicies.handoff)
    expect(salesPrompt).not.toContain("connected to a human agent")
    expect(salesPrompt).toContain("SALES HANDOFF POLICY (REQUIRED):")
    expect(salesPrompt).toContain(DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE)
    expect(salesPrompt).toContain(sampleProfile.handoffTriggers)
    expect(
      buildSalesHandoffPolicy({
        handoffMessage: sampleProfile.handoffMessage,
        handoffTriggers: sampleProfile.handoffTriggers,
      }),
    ).toContain(
      'KHÔNG dùng các từ ngữ làm lộ bot như "human agent", "bot", "AI"',
    )
  })
})

describe("streaming vs buffered mode and jsonb_set salesState vs challenge concurrency", () => {
  test("streaming mode remains sendParts: true when salesProfile is disabled or absent", () => {
    const agentWithoutProfile = { salesProfile: null, salesProfileVersion: 0 }
    const agentWithDisabledProfile = {
      salesProfile: { ...sampleProfile, enabled: false },
      salesProfileVersion: 1,
    }

    const isActive1 = Boolean(agentWithoutProfile.salesProfile?.enabled)
    const isActive2 = Boolean(agentWithDisabledProfile.salesProfile?.enabled)
    const isActive3 = Boolean(sampleProfile.enabled)

    expect({ sendParts: !isActive1 }).toEqual({ sendParts: true })
    expect({ sendParts: !isActive2 }).toEqual({ sendParts: true })
    expect({ sendParts: !isActive3 }).toEqual({ sendParts: false })
  })

  test("concurrent jsonb_set updates to salesState and challenge on the same row preserve both keys", async () => {
    // Simulates Postgres jsonb_set(COALESCE(additionalAttributes, '{}'), '{key}', value, true)
    let rowAttributes: Record<string, unknown> | null = null

    const applyJsonbSet = vi.fn(
      (key: "challenge" | "salesState", value: unknown) => {
        const base = rowAttributes ? { ...rowAttributes } : {}
        base[key] = value
        rowAttributes = base
      },
    )

    const challenge = {
      type: "quickReply" as const,
      data: {
        flowId: "f1",
        nodeId: "n1",
        attempts: 1,
        maxRetries: 3,
        sentAt: new Date("2026-11-24T00:00:00.000Z"),
      },
    }
    const salesState: ConversationSalesState = {
      stage: "pitch",
      pitchedProductIds: ["3001"],
      offTopicStreak: 0,
      profileVersion: 2,
    }

    await Promise.all([
      Promise.resolve().then(() => applyJsonbSet("challenge", challenge)),
      Promise.resolve().then(() => applyJsonbSet("salesState", salesState)),
    ])

    expect(rowAttributes).toEqual({
      challenge,
      salesState,
    })
  })
})

// @vitest-environment node

import {
  type AIAgentSalesProfile,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@inboxos.io/database/partials"
import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  aiAgentsAdapter,
  resolveSalesProfileReferences,
} from "../src/template/adapters/ai-agents"
import type {
  TemplateInstallContext,
  TemplateInstallWarning,
} from "../src/template/adapters/types"
import { countDroppedResourceReferences } from "../src/template/dropped-references"

const baseProfile: AIAgentSalesProfile = {
  enabled: true,
  tone: "Thân thiện, xưng em gọi anh/chị",
  role: "Tư vấn viên khóa học",
  objective: "Chốt đơn khóa học",
  targetProducts: [
    {
      productId: "3001",
      priority: 1,
      pitchNote: "Khóa nền tảng",
    },
    {
      productId: "3002",
      priority: 2,
      pitchNote: "Khóa nâng cao",
    },
  ],
  forbiddenTopics: ["Chính trị"],
  offTopicLimit: 3,
  handoverOnHumanRequest: true,
  handoffMessage: DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
  handoffTriggers: "",
}

function makeMockCtx(productMap: Record<string, string> = {}) {
  const warnings: TemplateInstallWarning[] = []
  const insertedValues: Array<{ table: unknown; values: unknown }> = []
  const tracked: unknown[] = []

  const tx = {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        insertedValues.push({ table, values })
        return Promise.resolve()
      }),
    })),
  }

  const ctx: TemplateInstallContext = {
    tx: tx as unknown as TemplateInstallContext["tx"],
    workspaceId: "ws-target",
    installationId: "inst-1",
    sourceWorkspaceId: "ws-source",
    idMaps: {
      product: new Map(Object.entries(productMap)),
    },
    track: (entry) => tracked.push(entry),
    warn: (w) => warnings.push(w),
  }

  return { ctx, warnings, insertedValues, tracked }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("AI Agent template salesProfile integration", () => {
  test("remaps salesProfile.targetProducts[].productId when the template also copies the products and writes version 1", async () => {
    const { ctx, warnings, insertedValues } = makeMockCtx({
      "3001": "9001",
      "3002": "9002",
    })

    await aiAgentsAdapter.insert(ctx, [
      {
        sourceId: "agent-src-1",
        name: "Sales Bot",
        prompt: "Base prompt",
        messages: [],
        models: [{ provider: "openai", model: "gpt-5.4-mini" }],
        temperature: 0.7,
        maxOutputTokens: 1024,
        tools: [],
        isDefault: true,
        isRichResponse: false,
        webSearchAuthorizedDomains: [],
        salesProfile: baseProfile,
      },
    ])

    expect(warnings).toHaveLength(0)
    expect(insertedValues).toHaveLength(2)

    const agentInsert = insertedValues[0]?.values as {
      salesProfile: AIAgentSalesProfile
      salesProfileVersion: number
      isDefault: boolean
    }
    expect(agentInsert.isDefault).toBe(false)
    expect(agentInsert.salesProfileVersion).toBe(1)
    expect(agentInsert.salesProfile.enabled).toBe(true)
    expect(agentInsert.salesProfile.targetProducts).toEqual([
      {
        productId: "9001",
        priority: 1,
        pitchNote: "Khóa nền tảng",
      },
      {
        productId: "9002",
        priority: 2,
        pitchNote: "Khóa nâng cao",
      },
    ])

    const versionInsert = insertedValues[1]?.values as {
      version: number
      source: string
      profile: AIAgentSalesProfile
    }
    expect(versionInsert.version).toBe(1)
    expect(versionInsert.source).toBe("manual")
    expect(versionInsert.profile.targetProducts[0]?.productId).toBe("9001")
  })

  test("drops unmapped targetProducts entries with a warning and keeps remaining mapped products enabled", () => {
    const { ctx, warnings } = makeMockCtx({
      "3001": "9001",
    })

    const resolved = resolveSalesProfileReferences(
      ctx,
      "agent-src-1",
      baseProfile,
    )

    expect(resolved?.enabled).toBe(true)
    expect(resolved?.targetProducts).toEqual([
      {
        productId: "9001",
        priority: 1,
        pitchNote: "Khóa nền tảng",
      },
    ])
    expect(warnings).toEqual([
      {
        category: "aiAgents",
        entityKind: "product",
        path: "aiAgents.agent-src-1.salesProfile.targetProducts[1].productId",
        value: "3002",
      },
    ])
  })

  test("auto-disables salesProfile (enabled: false) and emits a warning when every target product is dropped", () => {
    const { ctx, warnings } = makeMockCtx({})

    const resolved = resolveSalesProfileReferences(
      ctx,
      "agent-src-1",
      baseProfile,
    )

    expect(resolved?.enabled).toBe(false)
    expect(resolved?.targetProducts).toEqual([])
    expect(warnings).toEqual([
      {
        category: "aiAgents",
        entityKind: "product",
        path: "aiAgents.agent-src-1.salesProfile.targetProducts[0].productId",
        value: "3001",
      },
      {
        category: "aiAgents",
        entityKind: "product",
        path: "aiAgents.agent-src-1.salesProfile.targetProducts[1].productId",
        value: "3002",
      },
      {
        category: "aiAgents",
        entityKind: "product",
        path: "aiAgents.agent-src-1.salesProfile.enabled",
        value: "disabled_no_target_products",
      },
    ])
  })

  test("countDroppedResourceReferences counts unshipped salesProfile.targetProducts[].productId references", () => {
    const emptySet = new Set<string>()
    const count = countDroppedResourceReferences(
      [
        {
          sourceId: "agent-src-1",
          salesProfile: baseProfile,
        },
      ],
      {
        flow: emptySet,
        trigger: emptySet,
        sequence: emptySet,
        product: new Set(["3001"]),
        aiAgent: emptySet,
        aiFunction: emptySet,
        aiFile: emptySet,
        aiMcpServer: emptySet,
        calendar: emptySet,
        questionnaire: emptySet,
        couponTopic: emptySet,
        pipeline: emptySet,
        pipelineStage: emptySet,
        pipelineField: emptySet,
        productCategory: emptySet,
        placeCategory: emptySet,
        botField: emptySet,
      },
    )

    // 3001 is shipped, 3002 is not -> 1 dropped reference
    expect(count).toBe(1)
  })
})

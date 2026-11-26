// @vitest-environment node

import {
  type AIAgentSalesProfile,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@inboxos.io/database/partials"
import { beforeEach, describe, expect, test, vi } from "vitest"

type RouteConfig = {
  method: string
  path: string
  summary: string
  description?: string
  tags: string[]
  successStatus?: number
}

type CapturedProcedure = {
  route: RouteConfig
  handler?: (...args: any[]) => any
}

const { workspaceTokenAuthAPIForScope, capturedProcedures } = vi.hoisted(() => {
  const capturedProcedures: CapturedProcedure[] = []

  const makeProcedure = (route: RouteConfig) => {
    const record: CapturedProcedure = { route }
    capturedProcedures.push(record)

    const chain = {
      input: vi.fn(() => chain),
      output: vi.fn(() => chain),
      errors: vi.fn(() => chain),
      handler: vi.fn((fn: (...args: any[]) => any) => {
        record.handler = fn
        return { handler: fn }
      }),
    }
    return chain
  }

  const workspaceTokenAuthAPI = {
    route: vi.fn((config: RouteConfig) => makeProcedure(config)),
  }

  return {
    workspaceTokenAuthAPIForScope: vi.fn(
      (_scope: string) => workspaceTokenAuthAPI,
    ),
    capturedProcedures,
  }
})

vi.mock("@/orpc", () => ({ workspaceTokenAuthAPIForScope }))

const mockGenerateSalesProfileProposalPatch = vi.hoisted(() => vi.fn())
vi.mock("@inboxos.io/ai/sales-profile-proposer", () => ({
  generateSalesProfileProposalPatch: mockGenerateSalesProfileProposalPatch,
}))

const {
  aiAgentService,
  aiAgentSalesProfileService,
  aiAgentSalesProfileProposalService,
} = vi.hoisted(() => ({
  aiAgentService: {
    listAIAgents: vi.fn(),
    findBy: vi.fn(),
    create: vi.fn(),
    createAndReturn: vi.fn(),
    updateAIAgent: vi.fn(),
    delete: vi.fn(),
  },
  aiAgentSalesProfileService: {
    get: vi.fn(),
    update: vi.fn(),
    listVersions: vi.fn(),
    revert: vi.fn(),
    listMessages: vi.fn(),
    clear: vi.fn(),
  },
  aiAgentSalesProfileProposalService: {
    propose: vi.fn(),
  },
}))

vi.mock("@inboxos.io/business", () => ({
  aiAgentService,
  aiAgentSalesProfileService,
  aiAgentSalesProfileProposalService,
}))

vi.mock("@inboxos.io/business/errors", () => ({
  BROADCAST_PLAN_LIMIT_CODE: "broadcastPlanLimit",
  notFoundException: (message: string) => new Error(message),
}))

vi.mock("@inboxos.io/database/schema", () => {
  const schema = {
    pick: vi.fn(() => schema),
    extend: vi.fn(() => schema),
    omit: vi.fn(() => schema),
    and: vi.fn(() => schema),
  }
  return {
    createSelectSchema: vi.fn(() => schema),
    aiAgentModel: {},
  }
})

await import("@/features/ai-agents/api/public")

const findProcedure = (method: string, path: string) => {
  const found = capturedProcedures.find(
    (p) => p.route.method === method && p.route.path === path,
  )
  if (!found) {
    throw new Error(`No procedure registered for ${method} ${path}`)
  }
  return found
}

const sampleProfile: AIAgentSalesProfile = {
  enabled: true,
  tone: "Thân thiện, xưng em gọi anh/chị",
  role: "Tư vấn viên khóa học",
  objective: "Chốt đơn khóa 1",
  targetProducts: [
    {
      productId: "3001",
      priority: 1,
      pitchNote: "Ưu tiên đầu tiên",
    },
  ],
  forbiddenTopics: ["Chính trị"],
  offTopicLimit: 3,
  handoverOnHumanRequest: true,
  handoffMessage: DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
  handoffTriggers:
    "Đồng ý mua, muốn thanh toán, xin giảm giá ngoài chính sách, VIP 1:1",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("AI agent sales profile public API", () => {
  test("tenant isolation: a token from workspace B gets 404 when accessing an agent in workspace A", async () => {
    const getProc = findProcedure("GET", "/v1/ai-agents/{id}/sales-profile")
    aiAgentSalesProfileService.get.mockImplementationOnce(
      ({ workspaceId }: { workspaceId: string }) => {
        if (workspaceId !== "1001") {
          return Promise.reject(new Error("AI agent not found"))
        }
        return Promise.resolve({ profile: sampleProfile, version: 1 })
      },
    )

    await expect(
      getProc.handler?.({
        context: { workspace: { id: "2002" } },
        input: { id: "9001" },
      }),
    ).rejects.toThrow("AI agent not found")

    expect(aiAgentSalesProfileService.get).toHaveBeenCalledWith({
      workspaceId: "2002",
      aiAgentId: "9001",
    })
  })

  test("POST /v1/ai-agents/{id}/sales-profile/propose generates a proposal without writing the profile", async () => {
    const proposeProc = findProcedure(
      "POST",
      "/v1/ai-agents/{id}/sales-profile/propose",
    )
    const now = new Date("2026-11-24T00:00:00.000Z")
    aiAgentSalesProfileProposalService.propose.mockResolvedValueOnce({
      proposedProfile: sampleProfile,
      diff: [{ field: "tone", before: "", after: sampleProfile.tone }],
      adminMessage: {
        id: "7001",
        workspaceId: "1001",
        aiAgentId: "9001",
        role: "admin",
        content: "Xưng em gọi anh/chị",
        proposal: null,
        appliedVersion: null,
        createdById: null,
        createdAt: now,
        updatedAt: now,
      },
      assistantMessage: {
        id: "7002",
        workspaceId: "1001",
        aiAgentId: "9001",
        role: "assistant",
        content: "Đã đề xuất cập nhật: tone.",
        proposal: {
          proposedProfile: sampleProfile,
          diff: [{ field: "tone", before: "", after: sampleProfile.tone }],
        },
        appliedVersion: null,
        createdById: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    const response = await proposeProc.handler?.({
      context: { workspace: { id: "1001" } },
      input: { id: "9001", instruction: "Xưng em gọi anh/chị" },
    })

    expect(aiAgentSalesProfileService.update).not.toHaveBeenCalled()
    expect(aiAgentSalesProfileProposalService.propose).toHaveBeenCalledWith({
      workspaceId: "1001",
      aiAgentId: "9001",
      instruction: "Xưng em gọi anh/chị",
      generatePatch: mockGenerateSalesProfileProposalPatch,
    })
    expect(response.proposedProfile).toEqual(sampleProfile)
    expect(response.adminMessage).not.toHaveProperty("workspaceId")
    expect(response.assistantMessage).not.toHaveProperty("workspaceId")
  })

  test("POST /v1/ai-agents/{id}/sales-profile/apply saves the proposed profile, bumps version and marks messageId applied", async () => {
    const applyProc = findProcedure(
      "POST",
      "/v1/ai-agents/{id}/sales-profile/apply",
    )
    const now = new Date("2026-11-24T00:00:00.000Z")
    aiAgentSalesProfileService.update.mockResolvedValueOnce({
      profile: sampleProfile,
      version: 2,
      versionRecord: {
        id: "8002",
        workspaceId: "1001",
        aiAgentId: "9001",
        version: 2,
        profile: sampleProfile,
        source: "proposal",
        instruction: "Xưng em gọi anh/chị",
        createdById: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    const result = await applyProc.handler?.({
      context: { workspace: { id: "1001" } },
      input: {
        id: "9001",
        profile: sampleProfile,
        instruction: "Xưng em gọi anh/chị",
        messageId: "7002",
      },
    })

    expect(aiAgentSalesProfileService.update).toHaveBeenCalledWith({
      workspaceId: "1001",
      aiAgentId: "9001",
      profile: sampleProfile,
      source: "proposal",
      instruction: "Xưng em gọi anh/chị",
      messageId: "7002",
    })
    expect(result.version).toBe(2)
    expect(result.versionRecord.source).toBe("proposal")
    expect(result.versionRecord).not.toHaveProperty("workspaceId")
  })

  test("POST /v1/ai-agents/{id}/sales-profile/revert restores a historical version as a new revert entry", async () => {
    const revertProc = findProcedure(
      "POST",
      "/v1/ai-agents/{id}/sales-profile/revert",
    )
    const now = new Date("2026-11-24T00:00:00.000Z")
    aiAgentSalesProfileService.revert.mockResolvedValueOnce({
      profile: sampleProfile,
      version: 3,
      versionRecord: {
        id: "8003",
        workspaceId: "1001",
        aiAgentId: "9001",
        version: 3,
        profile: sampleProfile,
        source: "revert",
        instruction: "Revert to v1",
        createdById: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    const result = await revertProc.handler?.({
      context: { workspace: { id: "1001" } },
      input: { id: "9001", version: 1 },
    })

    expect(aiAgentSalesProfileService.revert).toHaveBeenCalledWith({
      workspaceId: "1001",
      aiAgentId: "9001",
      version: 1,
    })
    expect(result.version).toBe(3)
    expect(result.versionRecord.source).toBe("revert")
    expect(result.versionRecord).not.toHaveProperty("workspaceId")
  })

  test("GET and DELETE /v1/ai-agents/{id}/training-messages list and clear training messages", async () => {
    const listProc = findProcedure(
      "GET",
      "/v1/ai-agents/{id}/training-messages",
    )
    const clearProc = findProcedure(
      "DELETE",
      "/v1/ai-agents/{id}/training-messages",
    )
    const now = new Date("2026-11-24T00:00:00.000Z")

    aiAgentSalesProfileService.listMessages.mockResolvedValueOnce({
      items: [
        {
          id: "7001",
          workspaceId: "1001",
          aiAgentId: "9001",
          role: "admin",
          content: "Xưng em gọi anh/chị",
          proposal: null,
          appliedVersion: null,
          createdById: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      nextCursor: null,
    })
    aiAgentSalesProfileService.clear.mockResolvedValueOnce({ deletedCount: 2 })

    const listed = await listProc.handler?.({
      context: { workspace: { id: "1001" } },
      input: { id: "9001", limit: 20 },
    })
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]).not.toHaveProperty("workspaceId")

    await clearProc.handler?.({
      context: { workspace: { id: "1001" } },
      input: { id: "9001" },
    })
    expect(aiAgentSalesProfileService.clear).toHaveBeenCalledWith({
      workspaceId: "1001",
      aiAgentId: "9001",
    })
  })
})

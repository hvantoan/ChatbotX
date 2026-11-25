import {
  type AIAgentSalesProfile,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@inboxos.io/database/partials"
import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("../src/broadcast/plan-policy.service", () => ({
  broadcastPlanPolicyService: {},
}))

const {
  mockFindBy,
  mockInvalidateWorkspaceCache,
  mockLockAgent,
  mockCreateVersion,
  mockUpdateAgentSalesProfile,
  mockFindByVersion,
  mockListVersions,
  mockAppendMany,
  mockListMessages,
  mockMarkApplied,
  mockClearMessages,
  mockFindProductsByIds,
  mockTransaction,
  mockFindTrainingMessage,
} = vi.hoisted(() => {
  const txClient = {
    marker: "tx",
    query: {
      aiAgentTrainingMessageModel: {
        findFirst: vi.fn(async () => null),
      },
    },
  }
  return {
    mockFindBy: vi.fn(),
    mockInvalidateWorkspaceCache: vi.fn(),
    mockLockAgent: vi.fn(),
    mockCreateVersion: vi.fn(),
    mockUpdateAgentSalesProfile: vi.fn(),
    mockFindByVersion: vi.fn(),
    mockListVersions: vi.fn(),
    mockAppendMany: vi.fn(),
    mockListMessages: vi.fn(),
    mockMarkApplied: vi.fn(),
    mockClearMessages: vi.fn(),
    mockFindProductsByIds: vi.fn(),
    mockTransaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb(txClient),
    ),
    mockFindTrainingMessage: txClient.query.aiAgentTrainingMessageModel
      .findFirst as ReturnType<typeof vi.fn>,
  }
})

vi.mock("@inboxos.io/database/client", () => ({
  db: {
    transaction: mockTransaction,
  },
}))

vi.mock(
  "@inboxos.io/database/repositories/template-installed-resource",
  () => ({
    templateInstalledResourceRepository: {
      findLiveKeys: vi.fn(async () => []),
      findBlocking: vi.fn(async () => []),
    },
    templateUninstallRepository: {},
  }),
)

vi.mock("@inboxos.io/database/repositories", () => {
  class InvalidPipelineCursorError extends Error {
    constructor(message = "Invalid cursor") {
      super(message)
      this.name = "InvalidPipelineCursorError"
    }
  }
  return {
    InvalidPipelineCursorError,
    aiAgentSalesProfileVersionRepository: {
      lockAgent: mockLockAgent,
      create: mockCreateVersion,
      updateAgentSalesProfile: mockUpdateAgentSalesProfile,
      findByVersion: mockFindByVersion,
      listVersions: mockListVersions,
    },
    aiAgentTrainingMessageRepository: {
      appendMany: mockAppendMany,
      list: mockListMessages,
      markApplied: mockMarkApplied,
      clear: mockClearMessages,
    },
    productRepository: {
      findByIds: mockFindProductsByIds,
    },
  }
})

vi.mock("../src/ai-agent/service", () => ({
  aiAgentService: {
    findBy: mockFindBy,
    invalidateWorkspaceCache: mockInvalidateWorkspaceCache,
  },
}))

const { aiAgentSalesProfileService } = await import(
  "../src/ai-agent/sales-profile.service"
)

const workspaceId = "1001"
const aiAgentId = "2001"

const validProfile: AIAgentSalesProfile = {
  enabled: true,
  tone: "Thân thiện, xưng em gọi anh/chị",
  role: "Tư vấn viên khóa học tiếng Anh",
  objective: "Tư vấn và chốt khóa học IELTS",
  targetProducts: [
    {
      productId: "3001",
      priority: 1,
      pitchNote: "Ưu tiên cho người mất gốc",
    },
  ],
  forbiddenTopics: ["Chính trị", "Đối thủ"],
  offTopicLimit: 3,
  handoverOnHumanRequest: true,
  handoffMessage: DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
  handoffTriggers:
    "Đồng ý mua, muốn thanh toán, xin giảm giá ngoài chính sách, VIP 1:1",
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindBy.mockResolvedValue({
    id: aiAgentId,
    workspaceId,
    salesProfile: null,
    salesProfileVersion: 0,
  })
  mockLockAgent.mockResolvedValue({
    id: aiAgentId,
    workspaceId,
    salesProfile: null,
    salesProfileVersion: 0,
  })
  mockFindProductsByIds.mockResolvedValue([
    {
      id: "3001",
      workspaceId,
      status: "active",
      name: "Khóa 1",
    },
  ])
  mockCreateVersion.mockImplementation(async (input) => ({
    id: "9001",
    createdAt: new Date("2026-11-24T00:00:00.000Z"),
    updatedAt: new Date("2026-11-24T00:00:00.000Z"),
    ...input,
  }))
  mockUpdateAgentSalesProfile.mockResolvedValue({
    id: aiAgentId,
    workspaceId,
  })
})

describe("aiAgentSalesProfileService.get", () => {
  test("returns current profile and version when agent exists", async () => {
    mockFindBy.mockResolvedValueOnce({
      id: aiAgentId,
      workspaceId,
      salesProfile: validProfile,
      salesProfileVersion: 2,
    })

    const result = await aiAgentSalesProfileService.get({
      workspaceId,
      aiAgentId,
    })

    expect(result).toEqual({
      profile: validProfile,
      version: 2,
    })
  })

  test("throws 404 when agent belongs to another workspace or does not exist", async () => {
    mockFindBy.mockResolvedValueOnce(undefined)

    await expect(
      aiAgentSalesProfileService.get({
        workspaceId: "9999",
        aiAgentId,
      }),
    ).rejects.toThrow("AI agent not found")
  })
})

describe("aiAgentSalesProfileService.update", () => {
  test("increments version, writes version row, updates agent column and invalidates cache", async () => {
    mockLockAgent.mockResolvedValueOnce({
      id: aiAgentId,
      workspaceId,
      salesProfile: null,
      salesProfileVersion: 3,
    })

    const result = await aiAgentSalesProfileService.update({
      workspaceId,
      aiAgentId,
      profile: validProfile,
      source: "manual",
      actorId: "5001",
    })

    expect(result.version).toBe(4)
    expect(result.profile).toEqual(validProfile)
    expect(mockCreateVersion).toHaveBeenCalledWith(
      {
        workspaceId,
        aiAgentId,
        version: 4,
        profile: validProfile,
        source: "manual",
        instruction: null,
        createdById: "5001",
      },
      expect.anything(),
    )
    expect(mockUpdateAgentSalesProfile).toHaveBeenCalledWith(
      {
        workspaceId,
        aiAgentId,
        profile: validProfile,
        version: 4,
      },
      expect.anything(),
    )
    expect(mockInvalidateWorkspaceCache).toHaveBeenCalledWith(workspaceId)
  })

  test("marks training message as applied when messageId is supplied", async () => {
    await aiAgentSalesProfileService.update({
      workspaceId,
      aiAgentId,
      profile: validProfile,
      source: "proposal",
      instruction: "Ưu tiên khóa 1",
      messageId: "7001",
      actorId: "5001",
    })

    expect(mockMarkApplied).toHaveBeenCalledWith(
      {
        workspaceId,
        aiAgentId,
        messageId: "7001",
        version: 1,
      },
      expect.anything(),
    )
  })

  test("applies a proposal's diff onto the live profile, keeping newer edits", async () => {
    mockLockAgent.mockResolvedValueOnce({
      id: aiAgentId,
      workspaceId,
      salesProfile: {
        ...validProfile,
        objective: "Objective cũ",
        tone: "Giọng mới sau khi sửa tay",
      },
      salesProfileVersion: 2,
    })
    mockFindTrainingMessage.mockResolvedValueOnce({
      id: "7001",
      proposal: {
        proposedProfile: {
          ...validProfile,
          objective: "Objective mới",
          tone: "Giọng cũ trong snapshot",
        },
        diff: [
          {
            field: "objective",
            before: "Objective cũ",
            after: "Objective mới",
          },
        ],
      },
    })

    const result = await aiAgentSalesProfileService.update({
      workspaceId,
      aiAgentId,
      profile: {
        ...validProfile,
        objective: "Objective mới",
        tone: "Giọng cũ trong snapshot",
      },
      source: "proposal",
      messageId: "7001",
    })

    expect(result.profile.objective).toBe("Objective mới")
    expect(result.profile.tone).toBe("Giọng mới sau khi sửa tay")
    expect(mockUpdateAgentSalesProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({
          objective: "Objective mới",
          tone: "Giọng mới sau khi sửa tay",
        }),
      }),
      expect.anything(),
    )
  })

  test("rejects applying a proposal when a field it touches changed since", async () => {
    mockLockAgent.mockResolvedValueOnce({
      id: aiAgentId,
      workspaceId,
      salesProfile: { ...validProfile, objective: "Objective đã đổi tay" },
      salesProfileVersion: 2,
    })
    mockFindTrainingMessage.mockResolvedValueOnce({
      id: "7001",
      proposal: {
        proposedProfile: { ...validProfile, objective: "Objective mới" },
        diff: [
          {
            field: "objective",
            before: validProfile.objective,
            after: "Objective mới",
          },
        ],
      },
    })

    await expect(
      aiAgentSalesProfileService.update({
        workspaceId,
        aiAgentId,
        profile: { ...validProfile, objective: "Objective mới" },
        source: "proposal",
        messageId: "7001",
      }),
    ).rejects.toThrow("older profile")

    expect(mockCreateVersion).not.toHaveBeenCalled()
    expect(mockMarkApplied).not.toHaveBeenCalled()
  })

  test("rejects a foreign-workspace productId", async () => {
    mockFindProductsByIds.mockResolvedValueOnce([])

    await expect(
      aiAgentSalesProfileService.update({
        workspaceId,
        aiAgentId,
        profile: validProfile,
        source: "manual",
      }),
    ).rejects.toThrow("Product 3001 does not belong to this workspace.")

    expect(mockCreateVersion).not.toHaveBeenCalled()
    expect(mockUpdateAgentSalesProfile).not.toHaveBeenCalled()
  })

  test("rejects an inactive product", async () => {
    mockFindProductsByIds.mockResolvedValueOnce([
      {
        id: "3001",
        workspaceId,
        status: "inactive",
        name: "Khóa 1",
      },
    ])

    await expect(
      aiAgentSalesProfileService.update({
        workspaceId,
        aiAgentId,
        profile: validProfile,
        source: "manual",
      }),
    ).rejects.toThrow("Product 3001 is not active.")

    expect(mockCreateVersion).not.toHaveBeenCalled()
    expect(mockUpdateAgentSalesProfile).not.toHaveBeenCalled()
  })

  test("rejects duplicate targetProducts entries", async () => {
    await expect(
      aiAgentSalesProfileService.update({
        workspaceId,
        aiAgentId,
        profile: {
          ...validProfile,
          targetProducts: [
            { productId: "3001", priority: 1 },
            { productId: "3001", priority: 2 },
          ],
        },
        source: "manual",
      }),
    ).rejects.toThrow("Duplicate target products are not allowed.")

    expect(mockCreateVersion).not.toHaveBeenCalled()
    expect(mockUpdateAgentSalesProfile).not.toHaveBeenCalled()
  })
})

describe("aiAgentSalesProfileService.revert", () => {
  test("creates a new version with source 'revert' without rewriting history", async () => {
    mockLockAgent.mockResolvedValueOnce({
      id: aiAgentId,
      workspaceId,
      salesProfile: { ...validProfile, tone: "Cũ" },
      salesProfileVersion: 2,
    })
    mockFindByVersion.mockResolvedValueOnce({
      id: "8001",
      workspaceId,
      aiAgentId,
      version: 1,
      profile: validProfile,
      source: "manual",
      instruction: null,
      createdById: "5001",
    })

    const result = await aiAgentSalesProfileService.revert({
      workspaceId,
      aiAgentId,
      version: 1,
      actorId: "5001",
    })

    expect(result.version).toBe(3)
    expect(result.versionRecord.source).toBe("revert")
    expect(mockCreateVersion).toHaveBeenCalledWith(
      {
        workspaceId,
        aiAgentId,
        version: 3,
        profile: validProfile,
        source: "revert",
        instruction: "Revert to v1",
        createdById: "5001",
      },
      expect.anything(),
    )
    expect(mockInvalidateWorkspaceCache).toHaveBeenCalledWith(workspaceId)
  })
})

describe("aiAgentSalesProfileService training messages", () => {
  test("enforces tenant isolation when appending, listing or clearing messages", async () => {
    mockFindBy.mockResolvedValueOnce(undefined)
    await expect(
      aiAgentSalesProfileService.listMessages({
        workspaceId: "9999",
        aiAgentId,
      }),
    ).rejects.toThrow("AI agent not found")

    mockFindBy.mockResolvedValueOnce(undefined)
    await expect(
      aiAgentSalesProfileService.clear({
        workspaceId: "9999",
        aiAgentId,
      }),
    ).rejects.toThrow("AI agent not found")

    mockFindBy.mockResolvedValueOnce(undefined)
    await expect(
      aiAgentSalesProfileService.appendMessages({
        workspaceId: "9999",
        aiAgentId,
        messages: [{ role: "admin", content: "Hello" }],
      }),
    ).rejects.toThrow("AI agent not found")
  })

  test("appends validated messages, lists with keyset cursor, marks applied and clears", async () => {
    const cursor = "cursor_v1_7002"
    mockAppendMany.mockResolvedValueOnce([
      {
        id: "7001",
        workspaceId,
        aiAgentId,
        role: "admin",
        content: "Xưng em gọi anh/chị",
      },
    ])
    mockListMessages.mockResolvedValueOnce({
      items: [
        {
          id: "7001",
          workspaceId,
          aiAgentId,
          role: "admin",
          content: "Xưng em gọi anh/chị",
        },
      ],
      nextCursor: cursor,
    })
    mockMarkApplied.mockResolvedValueOnce({
      id: "7002",
      workspaceId,
      aiAgentId,
      role: "assistant",
      content: "Đã đề xuất",
      appliedVersion: 2,
    })
    mockClearMessages.mockResolvedValueOnce(4)

    const appended = await aiAgentSalesProfileService.appendMessages({
      workspaceId,
      aiAgentId,
      messages: [{ role: "admin", content: "Xưng em gọi anh/chị" }],
    })
    expect(appended).toHaveLength(1)

    const listed = await aiAgentSalesProfileService.listMessages({
      workspaceId,
      aiAgentId,
      cursor,
      limit: 10,
    })
    expect(listed.nextCursor).toBe(cursor)
    expect(mockListMessages).toHaveBeenCalledWith(
      {
        workspaceId,
        aiAgentId,
        cursor,
        limit: 10,
      },
      undefined,
    )

    const applied = await aiAgentSalesProfileService.markApplied({
      workspaceId,
      aiAgentId,
      messageId: "7002",
      version: 2,
    })
    expect(applied.appliedVersion).toBe(2)

    const cleared = await aiAgentSalesProfileService.clear({
      workspaceId,
      aiAgentId,
    })
    expect(cleared).toEqual({ deletedCount: 4 })
  })
})

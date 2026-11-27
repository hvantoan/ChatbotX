import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  MASTER_AGENT_PENDING_ACTION_TTL_MS,
  MASTER_AGENT_TIMEZONE,
  masterAgentService,
} from "../service"

const mocks = vi.hoisted(() => ({
  findFirstMessage: vi.fn(),
  findManyMessage: vi.fn(),
  findFirstConfig: vi.fn(),
  findManyPendingAction: vi.fn(),
  findFirstPendingAction: vi.fn(),
  insertValues: [] as Record<string, unknown>[],
  insertReturning: vi.fn(),
  insertOnConflict: vi.fn(),
  updates: [] as { set: Record<string, unknown>; where: unknown }[],
  updateReturning: [] as Record<string, unknown>[][],
  queueAdd: vi.fn(),
}))

vi.mock("@inboxos.io/database/client", () => {
  const db = {
    query: {
      masterAgentMessageModel: {
        findFirst: mocks.findFirstMessage,
        findMany: mocks.findManyMessage,
      },
      masterAgentConfigModel: { findFirst: mocks.findFirstConfig },
      masterAgentPendingActionModel: {
        findMany: mocks.findManyPendingAction,
        findFirst: mocks.findFirstPendingAction,
      },
    },
    transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(db),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        mocks.insertValues.push(value)
        return {
          returning: mocks.insertReturning,
          onConflictDoUpdate: mocks.insertOnConflict,
        }
      },
    }),
    update: () => ({
      set: (setValue: Record<string, unknown>) => ({
        where: (whereValue: unknown) => {
          mocks.updates.push({ set: setValue, where: whereValue })
          const returningRows = mocks.updateReturning.shift() ?? []
          // Drizzle's update builder is itself a promise when awaited without
          // `.returning()`: model it as one, with the method attached.
          return Object.assign(Promise.resolve(undefined), {
            returning: () => Promise.resolve(returningRows),
          })
        },
      }),
    }),
  }
  return {
    db,
    and: (...args: unknown[]) => ({ __and: args }),
    eq: (left: unknown, right: unknown) => ({ __eq: [left, right] }),
    gt: (left: unknown, right: unknown) => ({ __gt: [left, right] }),
    lt: (left: unknown, right: unknown) => ({ __lt: [left, right] }),
  }
})

vi.mock("@inboxos.io/database/schema", () => ({
  masterAgentMessageModel: {
    id: "MasterAgentMessage.id",
    workspaceId: "MasterAgentMessage.workspaceId",
    sessionId: "MasterAgentMessage.sessionId",
    role: "MasterAgentMessage.role",
    content: "MasterAgentMessage.content",
    status: "MasterAgentMessage.status",
    createdAt: "MasterAgentMessage.createdAt",
  },
  masterAgentConfigModel: {
    id: "MasterAgentConfig.id",
    workspaceId: "MasterAgentConfig.workspaceId",
    enabled: "MasterAgentConfig.enabled",
    autoApproveDiff: "MasterAgentConfig.autoApproveDiff",
    prompt: "MasterAgentConfig.prompt",
    models: "MasterAgentConfig.models",
  },
  masterAgentPendingActionModel: {
    id: "MasterAgentPendingAction.id",
    workspaceId: "MasterAgentPendingAction.workspaceId",
    sessionId: "MasterAgentPendingAction.sessionId",
    status: "MasterAgentPendingAction.status",
    expiresAt: "MasterAgentPendingAction.expiresAt",
    createdAt: "MasterAgentPendingAction.createdAt",
  },
}))

vi.mock("@inboxos.io/worker-config", () => ({
  AIJobAction: { processMasterAgent: "processMasterAgent" },
  aiAgentQueue: { add: mocks.queueAdd },
}))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.insertValues.length = 0
  mocks.updates.length = 0
  mocks.updateReturning.length = 0
  mocks.insertReturning
    .mockResolvedValueOnce([{ id: "u-1" }])
    .mockResolvedValueOnce([{ id: "a-1" }])
  mocks.findManyMessage.mockResolvedValue([
    {
      id: "u-1",
      role: "user",
      content: "hi",
      status: "completed",
      createdAt: new Date("2026-11-26T10:00:00.000Z"),
    },
  ])
  mocks.findManyPendingAction.mockResolvedValue([])
})

describe("sendMessage", () => {
  test("inserts user and pending assistant rows, queues the turn with member identity", async () => {
    await masterAgentService.sendMessage({
      workspaceId: "ws-1",
      memberId: "member-1",
      tokenId: null,
      message: "  hello there  ",
      sessionId: null,
    })

    expect(mocks.insertValues[0]).toMatchObject({
      workspaceId: "ws-1",
      role: "user",
      content: "hello there",
      status: "completed",
      createdById: "member-1",
    })
    expect(mocks.insertValues[1]).toMatchObject({
      role: "assistant",
      content: "",
      status: "pending",
    })
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "processMasterAgent",
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "ws-1",
          messageId: "a-1",
          memberId: "member-1",
          tokenId: null,
        }),
      }),
      { jobId: "master-agent-a-1" },
    )
  })

  test("the returned session is read with the caller's own identity, not anonymously", async () => {
    // Regression: the read path binds a member session to its owner, so the
    // session rows report `createdById` — passing no viewer identity to the
    // final `getSession` would throw "Session not found" after the write and
    // leave the queued turn orphaned.
    mocks.findManyMessage.mockResolvedValue([
      {
        id: "u-1",
        role: "user",
        content: "hi",
        status: "completed",
        createdById: "member-1",
        createdAt: new Date("2026-11-26T10:00:00.000Z"),
      },
    ])

    const view = await masterAgentService.sendMessage({
      workspaceId: "ws-1",
      memberId: "member-1",
      tokenId: null,
      message: "hi",
      sessionId: null,
    })

    expect(view.messages).toHaveLength(1)
  })

  test("another member cannot continue someone else's session", async () => {
    mocks.findFirstMessage.mockResolvedValue({
      id: "m-1",
      createdById: "member-1",
    })

    await expect(
      masterAgentService.sendMessage({
        workspaceId: "ws-1",
        memberId: "member-2",
        message: "hi",
        sessionId: "s-1",
      }),
    ).rejects.toThrow("Session not found")
    expect(mocks.insertValues).toHaveLength(0)
  })

  test("a superAdmin may continue another member's session", async () => {
    mocks.findFirstMessage.mockResolvedValue({
      id: "m-1",
      createdById: "member-1",
    })

    await masterAgentService.sendMessage({
      workspaceId: "ws-1",
      memberId: "admin-1",
      viewerIsSuperAdmin: true,
      message: "hi",
      sessionId: "s-1",
    })

    expect(mocks.insertValues).toHaveLength(2)
  })

  test("token-originated chats pass the token id into the job", async () => {
    await masterAgentService.sendMessage({
      workspaceId: "ws-1",
      memberId: null,
      tokenId: "tok-1",
      message: "hi",
      sessionId: null,
    })

    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "processMasterAgent",
      expect.objectContaining({
        data: expect.objectContaining({ tokenId: "tok-1", memberId: null }),
      }),
      expect.anything(),
    )
  })

  test("a new turn expires the session's unanswered pending actions first", async () => {
    mocks.findFirstMessage.mockResolvedValue({ id: "u-0" })

    await masterAgentService.sendMessage({
      workspaceId: "ws-1",
      memberId: "m-1",
      tokenId: null,
      message: "next question",
      sessionId: "s-existing",
    })

    // The first UPDATE of the call is the expiry sweep on the session's
    // pending rows — before the insert of the new turn.
    const expiry = mocks.updates[0]
    expect(expiry?.set).toEqual({ status: "expired" })
    const where = JSON.stringify(expiry?.where)
    expect(where).toContain("pending")
    expect(where).toContain("s-existing")
  })

  test("an empty message is a validation error before any write", async () => {
    await expect(
      masterAgentService.sendMessage({
        workspaceId: "ws-1",
        memberId: "m-1",
        tokenId: null,
        message: "   ",
        sessionId: null,
      }),
    ).rejects.toThrow()
    expect(mocks.insertValues).toHaveLength(0)
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  test("an unknown session id is a 404", async () => {
    mocks.findFirstMessage.mockResolvedValue(undefined)

    await expect(
      masterAgentService.sendMessage({
        workspaceId: "ws-1",
        memberId: "m-1",
        tokenId: null,
        message: "hi",
        sessionId: "s-missing",
      }),
    ).rejects.toThrow()
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })
})

describe("config", () => {
  test("getConfigView reports configured=false without a row", async () => {
    mocks.findFirstConfig.mockResolvedValue(undefined)

    const view = await masterAgentService.getConfigView({ workspaceId: "ws-1" })

    expect(view).toEqual({
      configured: false,
      enabled: false,
      autoApproveDiff: false,
      prompt: null,
      models: [],
    })
  })

  test("getConfigView maps a stored row", async () => {
    mocks.findFirstConfig.mockResolvedValue({
      enabled: true,
      autoApproveDiff: true,
      prompt: "custom",
      models: [{ provider: "openai", model: "gpt-x" }],
    })

    const view = await masterAgentService.getConfigView({ workspaceId: "ws-1" })

    expect(view).toMatchObject({
      configured: true,
      enabled: true,
      autoApproveDiff: true,
      prompt: "custom",
    })
  })

  test("upsertConfig writes the row on the workspace conflict key", async () => {
    mocks.findFirstConfig.mockResolvedValue({
      enabled: true,
      autoApproveDiff: false,
      prompt: null,
      models: [],
    })

    await masterAgentService.upsertConfig({
      workspaceId: "ws-1",
      enabled: true,
      autoApproveDiff: false,
      prompt: null,
      models: [],
    })

    expect(mocks.insertValues.at(-1)).toMatchObject({
      workspaceId: "ws-1",
      enabled: true,
    })
    expect(mocks.insertOnConflict).toHaveBeenCalledWith({
      target: "MasterAgentConfig.workspaceId",
      set: expect.objectContaining({ enabled: true }),
    })
  })
})

describe("createPendingAction", () => {
  test("freezes the execution shape, policy and expiry into the row", async () => {
    const row = {
      id: "pa-1",
      sessionId: "s-1",
      operationId: "broadcasts.schedule",
      args: { id: "b-1" },
      policy: "confirm_outbound",
      currentState: null,
      status: "pending",
      result: null,
      decidedById: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + MASTER_AGENT_PENDING_ACTION_TTL_MS),
      execution: {
        method: "POST",
        baseUrl: "https://api.example.com",
        pathTemplate: "/v1/broadcasts/{id}/schedule",
        pathParamNames: ["id"],
        queryParamNames: [],
        bodyParamNames: [],
        toolName: "broadcasts_schedule",
      },
    }
    mocks.insertReturning.mockReset()
    mocks.insertReturning.mockResolvedValue([row])

    const view = await masterAgentService.createPendingAction({
      workspaceId: "ws-1",
      sessionId: "s-1",
      messageId: "a-1",
      operationId: "broadcasts.schedule",
      args: { id: "b-1" },
      policy: "confirm_outbound",
      currentState: null,
      execution: row.execution as never,
    })

    expect(view).toMatchObject({
      id: "pa-1",
      operationId: "broadcasts.schedule",
      toolName: "broadcasts_schedule",
      status: "pending",
    })
    expect(view.resourcePath).toBe("/broadcasts/b-1")
  })
})

describe("claimPendingActionForExecution", () => {
  test("the claim is a conditional update on status=pending and expiry in the future", async () => {
    mocks.updateReturning.push([{ id: "pa-1", status: "approved" }])

    const row = await masterAgentService.claimPendingActionForExecution({
      workspaceId: "ws-1",
      actionId: "pa-1",
      decidedById: "m-9",
    })

    expect(row).toMatchObject({ id: "pa-1" })
    const claim = mocks.updates.at(-1)
    expect(claim?.set).toMatchObject({
      status: "approved",
      decidedById: "m-9",
    })
    // The single-winner guard: both the pending-status and the expiry
    // predicates land in one UPDATE's WHERE, so a loser of the race gets
    // zero rows back.
    const where = JSON.stringify(claim?.where)
    expect(where).toContain("pending")
    expect(where).toContain("__gt")
  })

  test("a lost race returns null — the caller refuses to execute twice", async () => {
    mocks.updateReturning.push([])

    const row = await masterAgentService.claimPendingActionForExecution({
      workspaceId: "ws-1",
      actionId: "pa-1",
      decidedById: "m-9",
    })

    expect(row).toBeNull()
  })

  test("another member cannot claim an action from a foreign session", async () => {
    mocks.findFirstPendingAction.mockResolvedValue({ sessionId: "s-1" })
    mocks.findFirstMessage.mockResolvedValue({
      id: "u-0",
      createdById: "member-1",
    })
    mocks.updateReturning.push([{ id: "pa-1", status: "approved" }])

    await expect(
      masterAgentService.claimPendingActionForExecution({
        workspaceId: "ws-1",
        actionId: "pa-1",
        decidedById: "member-2",
        viewerMemberId: "member-2",
      }),
    ).rejects.toThrow("Session not found")
    expect(mocks.updates).toHaveLength(0)
  })
})

describe("rejectPendingAction", () => {
  test("an already-decided action reports the conflict", async () => {
    mocks.updateReturning.push([])

    await expect(
      masterAgentService.rejectPendingAction({
        workspaceId: "ws-1",
        actionId: "pa-1",
        decidedById: "m-9",
      }),
    ).rejects.toThrow()
  })

  test("a win marks the action rejected with the decider", async () => {
    mocks.updateReturning.push([
      {
        id: "pa-1",
        sessionId: "s-1",
        operationId: "broadcasts.schedule",
        args: {},
        policy: "confirm_diff",
        currentState: null,
        status: "rejected",
        result: null,
        decidedById: "m-9",
        createdAt: new Date(),
        expiresAt: new Date(),
        execution: null,
      },
    ])

    const view = await masterAgentService.rejectPendingAction({
      workspaceId: "ws-1",
      actionId: "pa-1",
      decidedById: "m-9",
    })

    expect(view.status).toBe("rejected")
    expect(mocks.updates.at(-1)?.set).toMatchObject({
      status: "rejected",
      decidedById: "m-9",
    })
  })
})

describe("timezone", () => {
  test("the master agent is pinned to Asia/Saigon", () => {
    expect(MASTER_AGENT_TIMEZONE).toBe("Asia/Saigon")
  })
})

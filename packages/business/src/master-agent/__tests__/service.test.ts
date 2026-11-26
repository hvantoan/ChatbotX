import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  buildContactFilterForContact,
  MASTER_AGENT_TIMEZONE,
  masterAgentService,
  parseAsiaSaigonDateTime,
} from "../service"

const mocks = vi.hoisted(() => ({
  findFirstMessage: vi.fn(),
  findManyMessage: vi.fn(),
  findFirstContact: vi.fn(),
  findFirstContactInbox: vi.fn(),
  insertValues: [] as Record<string, unknown>[],
  insertReturning: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  queueAdd: vi.fn(),
  broadcastCreate: vi.fn(),
  broadcastFind: vi.fn(),
  broadcastUpdate: vi.fn(),
  broadcastUpdateDraft: vi.fn(),
  broadcastMoveToDraft: vi.fn(),
  broadcastStop: vi.fn(),
  broadcastList: vi.fn(),
}))

vi.mock("@chatbotx.io/database/client", () => {
  const db = {
    query: {
      masterAgentMessageModel: {
        findFirst: mocks.findFirstMessage,
        findMany: mocks.findManyMessage,
      },
      contactModel: { findFirst: mocks.findFirstContact },
      contactInboxModel: { findFirst: mocks.findFirstContactInbox },
      broadcastModel: { findMany: vi.fn() },
      aiAgentModel: { findFirst: vi.fn() },
    },
    transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(db),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        mocks.insertValues.push(value)
        return { returning: mocks.insertReturning }
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updateSet(value)
        return {
          where: (where: unknown) => {
            mocks.updateWhere(where)
            return Promise.resolve()
          },
        }
      },
    }),
    select: () => {
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: () => Promise.resolve([]),
      }
      return builder
    },
  }
  return {
    db,
    and: (...args: unknown[]) => ({ __and: args }),
    asc: (value: unknown) => ({ __asc: value }),
    desc: (value: unknown) => ({ __desc: value }),
    eq: (left: unknown, right: unknown) => ({ __eq: [left, right] }),
    inArray: (left: unknown, right: unknown) => ({ __in: [left, right] }),
    isNull: (value: unknown) => ({ __isNull: value }),
    like: (left: unknown, right: unknown) => ({ __like: [left, right] }),
  }
})

vi.mock("@chatbotx.io/database/schema", () => ({
  masterAgentMessageModel: {
    id: "MasterAgentMessage.id",
    workspaceId: "MasterAgentMessage.workspaceId",
    sessionId: "MasterAgentMessage.sessionId",
    role: "MasterAgentMessage.role",
    content: "MasterAgentMessage.content",
    status: "MasterAgentMessage.status",
    broadcastId: "MasterAgentMessage.broadcastId",
    createdAt: "MasterAgentMessage.createdAt",
  },
  contactModel: {
    id: "Contact.id",
    workspaceId: "Contact.workspaceId",
    fullName: "Contact.fullName",
    email: "Contact.email",
    createdAt: "Contact.createdAt",
  },
  contactInboxModel: {
    contactId: "ContactInbox.contactId",
    inboxId: "ContactInbox.inboxId",
    sourceId: "ContactInbox.sourceId",
    channel: "ContactInbox.channel",
  },
  inboxModel: { id: "Inbox.id", name: "Inbox.name" },
  broadcastModel: {
    id: "Broadcast.id",
    name: "Broadcast.name",
    status: "Broadcast.status",
    schedulesType: "Broadcast.schedulesType",
    schedulesAt: "Broadcast.schedulesAt",
    flowId: "Broadcast.flowId",
    contactFilter: "Broadcast.contactFilter",
    workspaceId: "Broadcast.workspaceId",
    deletedAt: "Broadcast.deletedAt",
    createdAt: "Broadcast.createdAt",
  },
}))

vi.mock("@chatbotx.io/worker-config", () => ({
  AIJobAction: { processMasterAgent: "processMasterAgent" },
  aiAgentQueue: { add: mocks.queueAdd },
}))

vi.mock("../../broadcast", () => ({
  broadcastService: {
    create: mocks.broadcastCreate,
    findByIdOrName: mocks.broadcastFind,
    update: mocks.broadcastUpdate,
    updateDraft: mocks.broadcastUpdateDraft,
    moveToDraft: mocks.broadcastMoveToDraft,
    stopSending: mocks.broadcastStop,
    list: mocks.broadcastList,
  },
}))

const message = (overrides: Record<string, unknown>) => ({
  id: "m-1",
  role: "user",
  content: "hi",
  status: "completed",
  broadcastId: null,
  createdAt: new Date("2026-11-26T10:00:00.000Z"),
  ...overrides,
})

const draftBroadcast = {
  id: "b-1",
  name: "Nhắc lịch K5",
  status: "draft",
  schedulesType: "future",
  schedulesAt: new Date("2026-11-27T13:00:00.000Z"),
  flowId: "flow-1",
  contactFilter: buildContactFilterForContact("c-1"),
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.insertValues.length = 0
  mocks.insertReturning
    .mockResolvedValueOnce([{ id: "u-1" }])
    .mockResolvedValueOnce([{ id: "a-1" }])
})

describe("Asia/Saigon time handling", () => {
  test("a wall-clock time is read as +07:00, not server-local time", () => {
    expect(parseAsiaSaigonDateTime("2026-11-27 20:00").toISOString()).toBe(
      "2026-11-27T13:00:00.000Z",
    )
    expect(MASTER_AGENT_TIMEZONE).toBe("Asia/Saigon")
  })

  test("rejects an unparseable time instead of silently sending now", () => {
    expect(() => parseAsiaSaigonDateTime("tomorrow evening")).toThrow()
  })
})

describe("draft audience", () => {
  test("pins the audience to one contact and lifts the DM requirement", () => {
    expect(buildContactFilterForContact("c-1")).toEqual({
      operator: "and",
      conditions: [
        { field: "contactId", operator: "eq", value: "c-1" },
        { field: "lastInteraction", operator: "isNotEmpty" },
      ],
    })
  })
})

describe("sendMessage", () => {
  test("stores both turns in the workspace and queues one turn", async () => {
    const getSession = vi
      .spyOn(masterAgentService, "getSession")
      .mockResolvedValue({
        sessionId: "s-1",
        status: "pending",
        messages: [],
        drafts: [],
      })

    const result = await masterAgentService.sendMessage({
      workspaceId: "ws-1",
      memberId: "member-1",
      message: "  Tóm tắt Zoom K5, nhắc 20:00 ngày 27/11  ",
      sessionId: null,
    })

    expect(result.status).toBe("pending")
    expect(mocks.insertValues).toHaveLength(2)
    expect(mocks.insertValues[0]).toMatchObject({
      workspaceId: "ws-1",
      sessionId: expect.any(String),
      role: "user",
      content: "Tóm tắt Zoom K5, nhắc 20:00 ngày 27/11",
      status: "completed",
      createdById: "member-1",
    })
    expect(mocks.insertValues[1]).toMatchObject({
      role: "assistant",
      content: "",
      status: "pending",
    })
    const sessionId = mocks.insertValues[0]?.sessionId
    expect(typeof sessionId).toBe("string")
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "processMasterAgent",
      {
        type: "processMasterAgent",
        data: { workspaceId: "ws-1", sessionId, messageId: "a-1" },
      },
      { jobId: "master-agent-a-1" },
    )
    expect(String(mocks.queueAdd.mock.calls[0]?.[2]?.jobId)).not.toContain(":")
    getSession.mockRestore()
  })

  test("refuses an empty message before writing anything", async () => {
    await expect(
      masterAgentService.sendMessage({
        workspaceId: "ws-1",
        message: "   ",
      }),
    ).rejects.toThrow("Message must not be empty.")
    expect(mocks.insertValues).toHaveLength(0)
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  test("refuses a sessionId from another workspace", async () => {
    mocks.findFirstMessage.mockResolvedValue(undefined)

    await expect(
      masterAgentService.sendMessage({
        workspaceId: "ws-2",
        message: "hello",
        sessionId: "session-of-ws-1",
      }),
    ).rejects.toThrow("Session not found")
    expect(mocks.findFirstMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-2", sessionId: "session-of-ws-1" },
      }),
    )
    expect(mocks.insertValues).toHaveLength(0)
  })
})

describe("getSession", () => {
  test("reads only the caller's workspace and reports the latest turn status", async () => {
    // The query returns the newest window first; the service reverses it.
    mocks.findManyMessage.mockResolvedValue([
      message({ id: "a-1", role: "assistant", status: "pending", content: "" }),
      message({ id: "u-1" }),
    ])

    const result = await masterAgentService.getSession({
      workspaceId: "ws-1",
      sessionId: "s-1",
    })

    expect(mocks.findManyMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-1", sessionId: "s-1" },
      }),
    )
    expect(result.status).toBe("pending")
    expect(result.messages.map((entry) => entry.id)).toEqual(["u-1", "a-1"])
  })

  test("a session of another workspace is a 404, not an empty answer", async () => {
    mocks.findManyMessage.mockResolvedValue([])

    await expect(
      masterAgentService.getSession({
        workspaceId: "ws-2",
        sessionId: "s-1",
      }),
    ).rejects.toThrow("Session not found")
  })
})

describe("draftReminder", () => {
  test("only ever creates a draft: no schedule, no send, no job", async () => {
    mocks.findFirstContact.mockResolvedValue({ id: "c-1" })
    mocks.findFirstContactInbox.mockResolvedValue({ id: "ci-1" })
    mocks.broadcastCreate.mockResolvedValue(draftBroadcast)

    const reminder = await masterAgentService.draftReminder({
      workspaceId: "ws-1",
      messageId: "a-1",
      contactId: "c-1",
      flowId: "flow-1",
      scheduledAt: "2026-11-27 20:00",
    })

    expect(mocks.broadcastCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        channel: "omnichannel",
        subaction: "allContacts",
        flowId: "flow-1",
        schedulesType: "future",
        schedulesAt: "2026-11-27T13:00:00.000Z",
        saveAsDraft: true,
        contactFilter: buildContactFilterForContact("c-1"),
      }),
    )
    expect(reminder).toMatchObject({
      id: "b-1",
      status: "draft",
      contactIds: ["c-1"],
    })
    // The turn is linked to the draft; nothing is enqueued or scheduled.
    expect(mocks.updateSet).toHaveBeenCalledWith({ broadcastId: "b-1" })
    expect(mocks.queueAdd).not.toHaveBeenCalled()
    expect(mocks.broadcastUpdateDraft).not.toHaveBeenCalled()
  })

  test("refuses a contact that is not in the workspace", async () => {
    mocks.findFirstContact.mockResolvedValue(undefined)

    await expect(
      masterAgentService.draftReminder({
        workspaceId: "ws-1",
        contactId: "c-other",
        flowId: "flow-1",
        scheduledAt: "2026-11-27 20:00",
      }),
    ).rejects.toThrow("Group contact not found")
    expect(mocks.broadcastCreate).not.toHaveBeenCalled()
  })

  test("refuses a workspace contact that is not a group", async () => {
    mocks.findFirstContact.mockResolvedValue({ id: "c-1" })
    mocks.findFirstContactInbox.mockResolvedValue(undefined)

    await expect(
      masterAgentService.draftReminder({
        workspaceId: "ws-1",
        contactId: "c-1",
        flowId: "flow-1",
        scheduledAt: "2026-11-27 20:00",
      }),
    ).rejects.toThrow("That contact is not a group contact.")
    expect(mocks.broadcastCreate).not.toHaveBeenCalled()
  })
})

describe("stopReminder", () => {
  test("a scheduled reminder goes back to draft instead of being sent", async () => {
    mocks.broadcastFind.mockResolvedValue({
      ...draftBroadcast,
      status: "scheduled",
    })
    mocks.broadcastMoveToDraft.mockResolvedValue({ id: "b-1" })
    vi.spyOn(masterAgentService, "getReminder").mockResolvedValue({
      ...draftBroadcast,
      contactIds: ["c-1"],
    } as never)

    await masterAgentService.stopReminder({
      workspaceId: "ws-1",
      broadcastId: "b-1",
    })

    expect(mocks.broadcastMoveToDraft).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      broadcastId: "b-1",
    })
    expect(mocks.broadcastStop).not.toHaveBeenCalled()
  })
})

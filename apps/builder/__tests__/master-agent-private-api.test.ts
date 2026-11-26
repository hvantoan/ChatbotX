// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

type MemberPermissions = {
  superAdmin?: boolean
  broadcast?: boolean
  flows?: boolean
}

const {
  authGetSession,
  findMembership,
  resolveWorkspaceAccess,
  isWorkspaceScheduledForDeletion,
  getAccessState,
  isAtLimit,
  sendMessage,
  getSession,
  getReminder,
  listGroups,
  scheduleDraft,
} = vi.hoisted(() => ({
  authGetSession: vi.fn(),
  findMembership: vi.fn(),
  resolveWorkspaceAccess: vi.fn(),
  isWorkspaceScheduledForDeletion: vi.fn().mockReturnValue(false),
  getAccessState: vi.fn().mockResolvedValue({ blocked: false }),
  isAtLimit: vi.fn().mockResolvedValue(false),
  sendMessage: vi.fn(),
  getSession: vi.fn(),
  getReminder: vi.fn(),
  listGroups: vi.fn(),
  scheduleDraft: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  workspaceMemberService: { findMembership },
  resolveWorkspaceAccess,
  isWorkspaceScheduledForDeletion,
  userQuotaService: { getAccessState },
  quotaEnforcementService: { isAtLimit },
  masterAgentService: { sendMessage, getSession, getReminder, listGroups },
  broadcastService: { scheduleDraft },
}))

vi.mock("@inboxos.io/business/audit", () => ({
  withAuditContext: (_actor: unknown, fn: () => unknown) => fn(),
}))

vi.mock("@/lib/auth/auth", () => ({
  auth: { api: { getSession: authGetSession } },
}))

vi.mock("@/lib/rate-limit/guest-rate-limit", () => ({
  getGuestClientIp: vi.fn().mockReturnValue("203.0.113.9"),
}))

vi.mock("@/lib/log", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/env", () => ({ isCloud: () => true }))

// Modules are imported after the `vi.mock` calls above: a static import would
// load the auth/business graph before the mocks exist.
const { call } = await import("@orpc/server")
const { masterAgentPrivateAPIs } = await import(
  "../src/features/master-agent/api/private"
)

const WORKSPACE_ID = "ws-1"
const USER_ID = "user-1"

const memberWith = (permissions: MemberPermissions) => ({
  workspace: { id: WORKSPACE_ID, ownerId: "owner-1" },
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
  permissions,
})

/** A member who may open the chat: both flags the Master Agent requires. */
const AUTHORIZED_PERMISSIONS: MemberPermissions = {
  broadcast: true,
  flows: true,
}

const session = {
  sessionId: "s-1",
  status: "pending" as const,
  messages: [
    {
      id: "u-1",
      role: "user" as const,
      content: "Tóm tắt Zoom K5, nhắc 20:00 ngày 27/11",
      status: "completed" as const,
      broadcastId: null,
      createdAt: new Date("2026-11-26T10:00:00.000Z"),
    },
  ],
  drafts: [],
}

const draft = {
  id: "b-1",
  name: "Nhắc lịch K5",
  status: "draft" as const,
  schedulesType: "future" as const,
  schedulesAt: new Date("2026-11-27T13:00:00.000Z"),
  flowId: "flow-1",
  contactIds: ["contact-1"],
}

/** Every procedure's input fields, so a loop exercises all three through the gate. */
const everyProcedureInput = {
  workspaceId: WORKSPACE_ID,
  message: "tóm tắt Zoom",
  sessionId: "s-1",
  broadcastId: "b-1",
}

const invoke = (procedure: unknown, input: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, {
    context: { headers: new Headers({ authorization: "Bearer test-token" }) },
  })

/** The gate may surface as the raw domain error or as its mapped ORPCError. */
const expectForbidden = async (promise: Promise<unknown>) => {
  const error = (await promise.catch((thrown: unknown) => thrown)) as {
    code?: string
    status?: number
    httpStatusCode?: number
  }
  expect(error.code).toBe("masterAgentForbidden")
  expect(error.status ?? error.httpStatusCode).toBe(403)
}

const signIn = () =>
  authGetSession.mockResolvedValue({
    session: { id: "session-1", ipAddress: null, userAgent: null },
    user: { id: USER_ID },
  })

const memberOf = (permissions: MemberPermissions) => {
  const member = memberWith(permissions)
  findMembership.mockResolvedValue(member)
  resolveWorkspaceAccess.mockResolvedValue({
    workspace: member.workspace,
    member,
    isSupportSession: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  isWorkspaceScheduledForDeletion.mockReturnValue(false)
  getAccessState.mockResolvedValue({ blocked: false })
  isAtLimit.mockResolvedValue(false)
  listGroups.mockResolvedValue([])
})

describe("Master Agent private API access control", () => {
  test("a signed-out caller gets 401 on every procedure and nothing is written", async () => {
    authGetSession.mockResolvedValue(null)

    for (const procedure of Object.values(masterAgentPrivateAPIs)) {
      await expect(
        invoke(procedure, everyProcedureInput),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 })
    }

    expect(sendMessage).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
    expect(scheduleDraft).not.toHaveBeenCalled()
  })

  test("a signed-in user who is not a workspace member is refused before any service call", async () => {
    signIn()
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue(undefined)

    for (const procedure of Object.values(masterAgentPrivateAPIs)) {
      await expect(
        invoke(procedure, everyProcedureInput),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    }

    expect(sendMessage).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
    expect(getReminder).not.toHaveBeenCalled()
  })

  test("a member without the broadcasts flag gets 403 on every procedure", async () => {
    signIn()
    memberOf({ flows: true })

    for (const procedure of Object.values(masterAgentPrivateAPIs)) {
      await expectForbidden(invoke(procedure, everyProcedureInput))
    }

    expect(sendMessage).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
    expect(scheduleDraft).not.toHaveBeenCalled()
  })

  test("a member without the flows flag gets 403 on every procedure", async () => {
    signIn()
    memberOf({ broadcast: true })

    for (const procedure of Object.values(masterAgentPrivateAPIs)) {
      await expectForbidden(invoke(procedure, everyProcedureInput))
    }

    expect(sendMessage).not.toHaveBeenCalled()
    expect(getReminder).not.toHaveBeenCalled()
    expect(scheduleDraft).not.toHaveBeenCalled()
  })
})

describe("sendMasterAgentMessageAPI", () => {
  beforeEach(() => {
    signIn()
    memberOf(AUTHORIZED_PERMISSIONS)
  })

  test("runs the shared service with the context workspace and the caller as the author", async () => {
    sendMessage.mockResolvedValue(session)

    const result = await invoke(
      masterAgentPrivateAPIs.sendMasterAgentMessageAPI,
      {
        workspaceId: WORKSPACE_ID,
        message: "Tóm tắt Zoom K5, nhắc 20:00 ngày 27/11",
      },
    )

    expect(sendMessage).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      memberId: USER_ID,
      message: "Tóm tắt Zoom K5, nhắc 20:00 ngày 27/11",
      sessionId: null,
    })
    expect(result).toMatchObject({ sessionId: "s-1", status: "pending" })
  })

  test("continues an existing session", async () => {
    sendMessage.mockResolvedValue(session)

    await invoke(masterAgentPrivateAPIs.sendMasterAgentMessageAPI, {
      workspaceId: WORKSPACE_ID,
      message: "đổi giờ sang 21:00",
      sessionId: "s-1",
    })

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s-1" }),
    )
  })

  test("an empty message never reaches the service", async () => {
    await expect(
      invoke(masterAgentPrivateAPIs.sendMasterAgentMessageAPI, {
        workspaceId: WORKSPACE_ID,
        message: "   ",
      }),
    ).rejects.toMatchObject({ code: "invalidRequestData" })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test("labels each draft with the group contact it targets", async () => {
    sendMessage.mockResolvedValue({ ...session, drafts: [draft] })
    listGroups.mockResolvedValue([
      {
        contactId: "contact-1",
        name: "Khoá K5",
        groupSourceId: "group:k5-demo",
        inboxId: "inbox-1",
        inboxName: "Khoá học",
        channel: "zalo_personal",
      },
    ])

    const result = (await invoke(
      masterAgentPrivateAPIs.sendMasterAgentMessageAPI,
      { workspaceId: WORKSPACE_ID, message: "nhắc K5" },
    )) as { drafts: { group: unknown }[] }

    expect(listGroups).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID })
    expect(result.drafts[0]?.group).toEqual({
      contactId: "contact-1",
      name: "Khoá K5",
      sourceId: "group:k5-demo",
    })
  })

  test("does not look up groups when the turn drafted nothing", async () => {
    sendMessage.mockResolvedValue(session)

    await invoke(masterAgentPrivateAPIs.sendMasterAgentMessageAPI, {
      workspaceId: WORKSPACE_ID,
      message: "chào",
    })

    expect(listGroups).not.toHaveBeenCalled()
  })
})

describe("getMasterAgentSessionAPI", () => {
  beforeEach(() => {
    signIn()
    memberOf(AUTHORIZED_PERMISSIONS)
  })

  test("reads the session through the shared service, scoped to the workspace", async () => {
    getSession.mockResolvedValue(session)

    await invoke(masterAgentPrivateAPIs.getMasterAgentSessionAPI, {
      workspaceId: WORKSPACE_ID,
      sessionId: "s-1",
    })

    expect(getSession).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      sessionId: "s-1",
    })
  })
})

describe("confirmMasterAgentDraftAPI", () => {
  beforeEach(() => {
    signIn()
    memberOf(AUTHORIZED_PERMISSIONS)
  })

  test("schedules the draft with its own stored schedule, never client input", async () => {
    getReminder.mockResolvedValue(draft)
    scheduleDraft.mockResolvedValue({ id: "b-1" })

    const result = await invoke(
      masterAgentPrivateAPIs.confirmMasterAgentDraftAPI,
      { workspaceId: WORKSPACE_ID, broadcastId: "b-1" },
    )

    expect(getReminder).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      broadcastId: "b-1",
    })
    expect(scheduleDraft).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      broadcastId: "b-1",
      schedulesType: "future",
      schedulesAt: draft.schedulesAt,
    })
    expect(result).toEqual({ id: "b-1" })
  })

  test("a draft of another workspace is a 404 and is never scheduled", async () => {
    const notFound = Object.assign(new Error("Reminder not found"), {
      code: "notFound",
      httpStatusCode: 404,
    })
    getReminder.mockRejectedValue(notFound)

    await expect(
      invoke(masterAgentPrivateAPIs.confirmMasterAgentDraftAPI, {
        workspaceId: WORKSPACE_ID,
        broadcastId: "b-other-workspace",
      }),
    ).rejects.toMatchObject({ code: "notFound" })
    expect(scheduleDraft).not.toHaveBeenCalled()
  })

  test("a broadcast that is no longer a draft cannot be re-scheduled here", async () => {
    getReminder.mockResolvedValue({ ...draft, status: "scheduled" })

    await expect(
      invoke(masterAgentPrivateAPIs.confirmMasterAgentDraftAPI, {
        workspaceId: WORKSPACE_ID,
        broadcastId: "b-1",
      }),
    ).rejects.toMatchObject({ code: "notFound" })
    expect(scheduleDraft).not.toHaveBeenCalled()
  })
})

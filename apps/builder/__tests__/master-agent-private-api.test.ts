// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  authGetSession,
  findMembership,
  resolveWorkspaceAccess,
  isWorkspaceScheduledForDeletion,
  getAccessState,
  isAtLimit,
  sendMessage,
  getSession,
  getConfigView,
  upsertConfig,
  rejectPendingAction,
  executePendingActionConfirmation,
} = vi.hoisted(() => ({
  authGetSession: vi.fn(),
  findMembership: vi.fn(),
  resolveWorkspaceAccess: vi.fn(),
  isWorkspaceScheduledForDeletion: vi.fn().mockReturnValue(false),
  getAccessState: vi.fn().mockResolvedValue({ blocked: false }),
  isAtLimit: vi.fn().mockResolvedValue(false),
  sendMessage: vi.fn(),
  getSession: vi.fn(),
  getConfigView: vi.fn(),
  upsertConfig: vi.fn(),
  rejectPendingAction: vi.fn(),
  executePendingActionConfirmation: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  workspaceMemberService: { findMembership },
  resolveWorkspaceAccess,
  isWorkspaceScheduledForDeletion,
  userQuotaService: { getAccessState },
  quotaEnforcementService: { isAtLimit },
  masterAgentService: {
    sendMessage,
    getSession,
    getConfigView,
    upsertConfig,
    rejectPendingAction,
  },
}))

vi.mock("@/lib/master-agent/execute-pending-action", () => ({
  executePendingActionConfirmation,
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

const session = {
  sessionId: "s-1",
  status: "pending" as const,
  messages: [
    {
      id: "u-1",
      role: "user" as const,
      content: "Tóm tắt Zoom K5",
      status: "completed" as const,
      createdAt: new Date("2026-11-26T10:00:00.000Z"),
    },
  ],
  pendingActions: [],
}

const configView = {
  configured: true,
  enabled: true,
  autoApproveDiff: false,
  prompt: null,
  models: [],
}

const invoke = (procedure: unknown, input: unknown) =>
  call(procedure as Parameters<typeof call>[0], input, {
    context: { headers: new Headers({ authorization: "Bearer test-token" }) },
  })

const signIn = () =>
  authGetSession.mockResolvedValue({
    session: { id: "session-1", ipAddress: null, userAgent: null },
    user: { id: USER_ID },
  })

const memberOf = (permissions: Record<string, boolean>) => {
  const member = {
    workspace: { id: WORKSPACE_ID, ownerId: "owner-1" },
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    permissions,
  }
  findMembership.mockResolvedValue(member)
  resolveWorkspaceAccess.mockResolvedValue({
    workspace: member.workspace,
    member,
    isSupportSession: false,
  })
}

/** Every procedure's input fields, so a loop exercises them all through the gate. */
const everyProcedureInput = {
  workspaceId: WORKSPACE_ID,
  message: "tóm tắt Zoom",
  sessionId: "s-1",
  actionId: "pa-1",
  enabled: true,
  autoApproveDiff: false,
  prompt: null,
  models: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  isWorkspaceScheduledForDeletion.mockReturnValue(false)
  getAccessState.mockResolvedValue({ blocked: false })
  isAtLimit.mockResolvedValue(false)
})

describe("Master Agent private API access control", () => {
  test("a signed-out caller gets 401 on every procedure and nothing runs", async () => {
    authGetSession.mockResolvedValue(null)

    for (const procedure of Object.values(masterAgentPrivateAPIs)) {
      await expect(
        invoke(procedure, everyProcedureInput),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 })
    }

    expect(sendMessage).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
  })

  test("a signed-in user outside the workspace is refused before any service call", async () => {
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
  })

  test("any member may chat and read sessions — per-operation rights come from the credential", async () => {
    signIn()
    memberOf({})
    sendMessage.mockResolvedValue(session)

    const result = await invoke(
      masterAgentPrivateAPIs.sendMasterAgentMessageAPI,
      { workspaceId: WORKSPACE_ID, message: "chào" },
    )

    expect(result).toMatchObject({ sessionId: "s-1" })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        memberId: USER_ID,
        message: "chào",
        sessionId: null,
      }),
    )
  })
})

describe("sendMasterAgentMessageAPI", () => {
  beforeEach(() => {
    signIn()
    memberOf({})
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
})

describe("getMasterAgentSessionAPI", () => {
  test("reads the session scoped to the workspace", async () => {
    signIn()
    memberOf({})
    getSession.mockResolvedValue(session)

    await invoke(masterAgentPrivateAPIs.getMasterAgentSessionAPI, {
      workspaceId: WORKSPACE_ID,
      sessionId: "s-1",
    })

    expect(getSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        sessionId: "s-1",
        viewerMemberId: "user-1",
      }),
    )
  })
})

describe("config procedures", () => {
  test("any member may read the config", async () => {
    signIn()
    memberOf({})
    getConfigView.mockResolvedValue(configView)

    const result = await invoke(
      masterAgentPrivateAPIs.getMasterAgentConfigAPI,
      {
        workspaceId: WORKSPACE_ID,
      },
    )

    expect(result).toMatchObject({ configured: true, enabled: true })
  })

  test("updateConfig requires the flows permission", async () => {
    signIn()
    memberOf({ contacts: true })

    await expect(
      invoke(masterAgentPrivateAPIs.updateMasterAgentConfigAPI, {
        workspaceId: WORKSPACE_ID,
        enabled: true,
        autoApproveDiff: false,
        prompt: null,
        models: [],
      }),
    ).rejects.toMatchObject({ code: "masterAgentForbidden" })
    expect(upsertConfig).not.toHaveBeenCalled()
  })

  test("a flows-permission member may update the config", async () => {
    signIn()
    memberOf({ flows: true })
    upsertConfig.mockResolvedValue({ ...configView, autoApproveDiff: true })

    const result = await invoke(
      masterAgentPrivateAPIs.updateMasterAgentConfigAPI,
      {
        workspaceId: WORKSPACE_ID,
        enabled: true,
        autoApproveDiff: true,
        prompt: "be brief",
        models: [{ provider: "openai", model: "gpt-x" }],
      },
    )

    expect(result).toMatchObject({ autoApproveDiff: true })
    expect(upsertConfig).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      enabled: true,
      autoApproveDiff: true,
      prompt: "be brief",
      models: [{ provider: "openai", model: "gpt-x" }],
    })
  })
})

describe("pending action decisions", () => {
  beforeEach(() => {
    signIn()
    memberOf({})
  })

  test("confirm runs the stored call with the reviewer as the executor", async () => {
    executePendingActionConfirmation.mockResolvedValue({
      id: "pa-1",
      status: "approved",
      result: { ok: true },
    })

    const result = await invoke(
      masterAgentPrivateAPIs.confirmMasterAgentPendingActionAPI,
      { workspaceId: WORKSPACE_ID, actionId: "pa-1" },
    )

    expect(result).toMatchObject({ id: "pa-1", status: "approved" })
    expect(executePendingActionConfirmation).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      actionId: "pa-1",
      memberId: USER_ID,
    })
  })

  test("reject marks the action rejected with the reviewer as the decider", async () => {
    rejectPendingAction.mockResolvedValue({
      id: "pa-1",
      operationId: "broadcasts.schedule",
      toolName: "broadcasts_schedule",
      args: {},
      policy: "confirm_outbound",
      currentState: null,
      status: "rejected",
      result: null,
      resourcePath: null,
      expiresAt: new Date(),
      createdAt: new Date(),
    })

    await invoke(masterAgentPrivateAPIs.rejectMasterAgentPendingActionAPI, {
      workspaceId: WORKSPACE_ID,
      actionId: "pa-1",
    })

    expect(rejectPendingAction).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      actionId: "pa-1",
      decidedById: USER_ID,
    })
  })
})

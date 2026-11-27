// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  findWorkspaceByTokenHash,
  isWorkspaceScheduledForDeletion,
  getAccessState,
  isAtLimit,
  assertApiNotRateLimited,
  sendMessage,
  getSession,
  getConfigView,
  upsertConfig,
  rejectPendingAction,
  executePendingActionConfirmation,
  userFindById,
  findMembership,
  resolveWorkspaceAccess,
} = vi.hoisted(() => ({
  findWorkspaceByTokenHash: vi.fn(),
  isWorkspaceScheduledForDeletion: vi.fn(),
  getAccessState: vi.fn(),
  isAtLimit: vi.fn(),
  assertApiNotRateLimited: vi.fn(),
  sendMessage: vi.fn(),
  getSession: vi.fn(),
  getConfigView: vi.fn(),
  upsertConfig: vi.fn(),
  rejectPendingAction: vi.fn(),
  executePendingActionConfirmation: vi.fn(),
  userFindById: vi.fn(),
  findMembership: vi.fn(),
  resolveWorkspaceAccess: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  workspaceApiTokenService: { findWorkspaceByTokenHash },
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
  userService: { findById: userFindById },
  workspaceMemberService: { findMembership },
  resolveWorkspaceAccess,
  hasWorkspacePermission: (
    permissions: Record<string, boolean | undefined>,
    key: string,
  ) => permissions.superAdmin === true || permissions[key] === true,
}))

vi.mock("@/lib/master-agent/execute-pending-action", () => ({
  executePendingActionConfirmation,
}))

vi.mock("@/lib/log", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/rate-limit/api-rate-limit", () => ({
  assertApiNotRateLimited,
}))

vi.mock("@/lib/rate-limit/guest-rate-limit", () => ({
  getGuestClientIp: () => "203.0.113.9",
}))

const TEST_SECRET = "test-secret-at-least-32-characters-long"
vi.mock("@/env", () => ({
  isCloud: () => true,
  env: { BETTER_AUTH_SECRET: TEST_SECRET },
}))

// `@/orpc` also exports `authorizedAPI`, which pulls in the full better-auth
// stack via `authMiddleware` — irrelevant here and unsafe to initialize in a
// unit test. Same stub as the other public-scope tests.
vi.mock("@/middlewares/auth", () => ({
  authMiddleware: vi.fn(),
}))

const { call } = await import("@orpc/server")
const { masterAgentPublicRouter } = await import(
  "../src/features/master-agent/api/public"
)

const TOKEN = "cbx_ws_fixture"

const authResult = (scopes: string[] | null, tokenId = "token-1") => ({
  workspace: { id: "ws-1", ownerId: "owner-1" },
  apiToken: { id: tokenId, permission: "full" as const, scopes },
})

const session = {
  sessionId: "s-1",
  status: "pending",
  messages: [
    {
      id: "u-1",
      role: "user",
      content: "Tóm tắt Zoom K5",
      status: "completed",
      createdAt: new Date("2026-11-26T10:00:00.000Z"),
    },
  ],
  pendingActions: [],
}

const invoke = (
  procedure: unknown,
  input: unknown = {},
  headers: Headers = new Headers({ Authorization: `Bearer ${TOKEN}` }),
) =>
  call(procedure as Parameters<typeof call>[0], input, { context: { headers } })

beforeEach(() => {
  vi.clearAllMocks()
  isWorkspaceScheduledForDeletion.mockReturnValue(false)
  getAccessState.mockResolvedValue({ blocked: false })
  isAtLimit.mockResolvedValue(false)
  assertApiNotRateLimited.mockResolvedValue(undefined)
  findWorkspaceByTokenHash.mockResolvedValue(authResult(null))
  sendMessage.mockResolvedValue(session)
  getSession.mockResolvedValue(session)
})

describe("master agent public API auth", () => {
  test("a request without a token is refused with 401 before any service call", async () => {
    await expect(
      invoke(
        masterAgentPublicRouter.sendMessage,
        { message: "hi" },
        new Headers(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CHATBOT_TOKEN" })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test("a token scoped outside automation is refused with 403", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["contacts"]))

    await expect(
      invoke(masterAgentPublicRouter.sendMessage, { message: "hi" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test("an automation-scoped token reaches the service", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["automation"]))

    const result = await invoke(masterAgentPublicRouter.sendMessage, {
      message: "hi",
    })

    expect(result).toMatchObject({ sessionId: "s-1" })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", message: "hi" }),
    )
  })

  test("an OAuth caller's turn acts as its user, never as a fake token id", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(
      authResult(null, "oauth:client-1:user-9"),
    )

    await invoke(masterAgentPublicRouter.sendMessage, { message: "hi" })

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "user-9", tokenId: null }),
    )
  })

  test("an unrestricted token passes the token id into the chat", async () => {
    await invoke(masterAgentPublicRouter.sendMessage, { message: "hi" })

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: "token-1", memberId: null }),
    )
  })
})

describe("master agent config procedures", () => {
  test("getConfig returns the config view", async () => {
    getConfigView.mockResolvedValue({
      configured: true,
      enabled: true,
      autoApproveDiff: false,
      prompt: null,
      models: [],
    })

    const result = await invoke(masterAgentPublicRouter.getConfig, {})

    expect(result).toMatchObject({ configured: true, enabled: true })
    expect(getConfigView).toHaveBeenCalledWith({ workspaceId: "ws-1" })
  })

  test("updateConfig upserts the workspace row", async () => {
    upsertConfig.mockResolvedValue({
      configured: true,
      enabled: true,
      autoApproveDiff: true,
      prompt: "x",
      models: [{ provider: "openai", model: "gpt-x" }],
    })

    const result = await invoke(masterAgentPublicRouter.updateConfig, {
      enabled: true,
      autoApproveDiff: true,
      prompt: "x",
      models: [{ provider: "openai", model: "gpt-x" }],
    })

    expect(result).toMatchObject({ autoApproveDiff: true })
    expect(upsertConfig).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", autoApproveDiff: true }),
    )
  })

  test("a member without the flows permission cannot write the config", async () => {
    userFindById.mockResolvedValue({ id: "m-1", deletionRequestedAt: null })
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue({
      workspace: { id: "ws-1", ownerId: "owner-1" },
      member: { permissions: { contacts: true } },
    })
    const { mintMasterAgentCredential } = await import(
      "@inboxos.io/business/master-agent/internal-credential"
    )
    const jwt = await mintMasterAgentCredential({
      workspaceId: "ws-1",
      memberId: "m-1",
      sessionId: "s-1",
      secret: TEST_SECRET,
    })

    await expect(
      invoke(
        masterAgentPublicRouter.updateConfig,
        {
          enabled: true,
          autoApproveDiff: false,
          prompt: null,
          models: [{ provider: "openai", model: "gpt-x" }],
        },
        new Headers({ Authorization: `Bearer ${jwt}` }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(upsertConfig).not.toHaveBeenCalled()
  })

  test("a non-superAdmin member credential cannot reach masterAgent routes at all", async () => {
    userFindById.mockResolvedValue({ id: "m-1", deletionRequestedAt: null })
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue({
      workspace: { id: "ws-1", ownerId: "owner-1" },
      member: { permissions: { flows: true } },
    })
    upsertConfig.mockResolvedValue({
      configured: true,
      enabled: true,
      autoApproveDiff: false,
      prompt: null,
      models: [],
    })
    const { mintMasterAgentCredential } = await import(
      "@inboxos.io/business/master-agent/internal-credential"
    )
    const jwt = await mintMasterAgentCredential({
      workspaceId: "ws-1",
      memberId: "m-1",
      sessionId: "s-1",
      secret: TEST_SECRET,
    })

    // Member credentials share the mobile reviewed-route allowlist, which
    // `masterAgent.*` operations are not part of — the agent's own catalog
    // excludes them, and the member's chat runs through the private API.
    // Even the flows permission does not open an unreviewed route.
    await expect(
      invoke(
        masterAgentPublicRouter.updateConfig,
        {
          enabled: true,
          autoApproveDiff: false,
          prompt: null,
          models: [],
        },
        new Headers({ Authorization: `Bearer ${jwt}` }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(upsertConfig).not.toHaveBeenCalled()
  })

  test("a superAdmin member credential reaches the handler", async () => {
    userFindById.mockResolvedValue({ id: "m-1", deletionRequestedAt: null })
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue({
      workspace: { id: "ws-1", ownerId: "owner-1" },
      member: { permissions: { superAdmin: true } },
    })
    upsertConfig.mockResolvedValue({
      configured: true,
      enabled: true,
      autoApproveDiff: false,
      prompt: null,
      models: [],
    })
    const { mintMasterAgentCredential } = await import(
      "@inboxos.io/business/master-agent/internal-credential"
    )
    const jwt = await mintMasterAgentCredential({
      workspaceId: "ws-1",
      memberId: "m-1",
      sessionId: "s-1",
      secret: TEST_SECRET,
    })

    await invoke(
      masterAgentPublicRouter.updateConfig,
      {
        enabled: true,
        autoApproveDiff: false,
        prompt: null,
        models: [],
      },
      new Headers({ Authorization: `Bearer ${jwt}` }),
    )

    expect(upsertConfig).toHaveBeenCalled()
  })
})

describe("pending action decisions", () => {
  test("confirm runs the stored call with the token caller's identity", async () => {
    executePendingActionConfirmation.mockResolvedValue({
      id: "pa-1",
      status: "approved",
      result: { ok: true },
    })

    const result = await invoke(masterAgentPublicRouter.confirmPendingAction, {
      actionId: "pa-1",
    })

    expect(result).toMatchObject({ id: "pa-1", status: "approved" })
    expect(executePendingActionConfirmation).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      actionId: "pa-1",
      memberId: null,
      tokenId: "token-1",
      viewerMemberId: null,
      viewerIsSuperAdmin: false,
    })
  })

  test("reject marks the action rejected", async () => {
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

    await invoke(masterAgentPublicRouter.rejectPendingAction, {
      actionId: "pa-1",
    })

    expect(rejectPendingAction).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      actionId: "pa-1",
      decidedById: null,
      viewerMemberId: null,
      viewerIsSuperAdmin: false,
    })
  })
})

describe("session reads", () => {
  test("getSession is workspace-scoped", async () => {
    await invoke(masterAgentPublicRouter.getSession, { sessionId: "s-1" })

    expect(getSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        sessionId: "s-1",
      }),
    )
  })
})

describe("master-agent internal credential authentication", () => {
  const mintFor = async (overrides: Record<string, unknown> = {}) => {
    const { mintMasterAgentCredential } = await import(
      "@inboxos.io/business/master-agent/internal-credential"
    )
    return await mintMasterAgentCredential({
      workspaceId: "ws-1",
      memberId: "m-1",
      sessionId: "s-1",
      secret: TEST_SECRET,
      ...overrides,
    })
  }

  test("a minted credential reaches the service with the member identity", async () => {
    userFindById.mockResolvedValue({ id: "m-1", deletionRequestedAt: null })
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue({
      workspace: { id: "ws-1", ownerId: "owner-1" },
      member: { permissions: { superAdmin: true } },
    })
    const jwt = await mintFor()

    const result = await invoke(
      masterAgentPublicRouter.sendMessage,
      { message: "hi" },
      new Headers({ Authorization: `Bearer ${jwt}` }),
    )

    expect(result).toMatchObject({ sessionId: "s-1" })
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "m-1", tokenId: null }),
    )
    expect(findWorkspaceByTokenHash).not.toHaveBeenCalled()
  })

  test("an expired credential is a 401", async () => {
    const jwt = await mintFor({
      nowMs: Date.now() - 10 * 60 * 1000, // minted 10 minutes ago, TTL is 5
    })

    await expect(
      invoke(
        masterAgentPublicRouter.sendMessage,
        { message: "hi" },
        new Headers({ Authorization: `Bearer ${jwt}` }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CHATBOT_TOKEN" })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test("a credential whose member lacks the automation scope is a 403", async () => {
    userFindById.mockResolvedValue({ id: "m-1", deletionRequestedAt: null })
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue({
      workspace: { id: "ws-1", ownerId: "owner-1" },
      member: { permissions: { analytics: true } },
    })
    const jwt = await mintFor()

    await expect(
      invoke(
        masterAgentPublicRouter.sendMessage,
        { message: "hi" },
        new Headers({ Authorization: `Bearer ${jwt}` }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

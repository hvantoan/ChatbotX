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
} = vi.hoisted(() => ({
  findWorkspaceByTokenHash: vi.fn(),
  isWorkspaceScheduledForDeletion: vi.fn(),
  getAccessState: vi.fn(),
  isAtLimit: vi.fn(),
  assertApiNotRateLimited: vi.fn(),
  sendMessage: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  workspaceApiTokenService: { findWorkspaceByTokenHash },
  isWorkspaceScheduledForDeletion,
  userQuotaService: { getAccessState },
  quotaEnforcementService: { isAtLimit },
  masterAgentService: { sendMessage, getSession },
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

vi.mock("@/env", () => ({ isCloud: () => true }))

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

const authResult = (scopes: string[] | null) => ({
  workspace: { id: "ws-1", ownerId: "owner-1" },
  apiToken: { id: "token-1", permission: "full" as const, scopes },
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
      broadcastId: null,
      createdAt: new Date("2026-11-26T10:00:00.000Z"),
    },
  ],
  drafts: [],
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
})

describe("master agent public API auth", () => {
  test("a request without a token is refused with 401 before any service call", async () => {
    await expect(
      invoke(
        masterAgentPublicRouter.sendMessage,
        { message: "hi" },
        new Headers(),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_CHATBOT_TOKEN",
      status: 401,
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test("a token without the broadcasts scope is refused with 403", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(["contacts"]))

    await expect(
      invoke(masterAgentPublicRouter.sendMessage, { message: "hi" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Token is not authorized for the 'broadcasts' scope",
    })
    await expect(
      invoke(masterAgentPublicRouter.getSession, { sessionId: "s-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
  })
})

describe("POST /v1/master-agent/messages", () => {
  beforeEach(() => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(null))
  })

  test("delegates to the shared service with the token's workspace", async () => {
    sendMessage.mockResolvedValue(session)

    const result = await invoke(masterAgentPublicRouter.sendMessage, {
      message: "Tóm tắt Zoom K5, nhắc 20:00 ngày 27/11",
    })

    expect(sendMessage).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      memberId: null,
      message: "Tóm tắt Zoom K5, nhắc 20:00 ngày 27/11",
      sessionId: null,
    })
    expect(result).toMatchObject({ sessionId: "s-1", status: "pending" })
  })

  test("an empty message is rejected by input validation before the service", async () => {
    // oRPC's validation code; the HTTP adapter renders it as 400.
    await expect(
      invoke(masterAgentPublicRouter.sendMessage, { message: "   " }),
    ).rejects.toMatchObject({ code: "invalidRequestData" })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test("a missing message is rejected by input validation before the service", async () => {
    await expect(
      invoke(masterAgentPublicRouter.sendMessage, {}),
    ).rejects.toMatchObject({ code: "invalidRequestData" })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  test("a workspaceId in the body cannot override the token's workspace", async () => {
    sendMessage.mockResolvedValue(session)

    await invoke(masterAgentPublicRouter.sendMessage, {
      message: "hi",
      workspaceId: "ws-other",
    })

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1" }),
    )
  })
})

describe("GET /v1/master-agent/sessions/{sessionId}", () => {
  test("scopes the read to the token's workspace, never the id alone", async () => {
    findWorkspaceByTokenHash.mockResolvedValue(authResult(null))
    getSession.mockResolvedValue(session)

    await invoke(masterAgentPublicRouter.getSession, {
      sessionId: "session-of-another-workspace",
    })

    expect(getSession).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      sessionId: "session-of-another-workspace",
    })
  })
})

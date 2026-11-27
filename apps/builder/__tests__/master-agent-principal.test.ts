// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  findWorkspaceAndTokenById,
  findMembership,
  resolveWorkspaceAccess,
  userFindById,
} = vi.hoisted(() => ({
  findWorkspaceAndTokenById: vi.fn(),
  findMembership: vi.fn(),
  resolveWorkspaceAccess: vi.fn(),
  userFindById: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  workspaceApiTokenService: { findWorkspaceAndTokenById },
  workspaceMemberService: { findMembership },
  resolveWorkspaceAccess,
  userService: { findById: userFindById },
  hasWorkspacePermission: (
    permissions: Record<string, boolean | undefined>,
    key: string,
  ) => permissions.superAdmin === true || permissions[key] === true,
}))

const { resolveMasterAgentWorkspacePrincipal } = await import(
  "../src/lib/master-agent/resolve-master-agent-principal"
)

const memberPayload = {
  purpose: "master-agent" as const,
  workspaceId: "ws-1",
  memberId: "m-1",
  sessionId: "s-1",
  iat: 1,
  exp: 2,
}

const tokenPayload = {
  purpose: "master-agent" as const,
  workspaceId: "ws-1",
  tokenId: "tok-1",
  sessionId: "s-1",
  iat: 1,
  exp: 2,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("resolveMasterAgentWorkspacePrincipal", () => {
  test("a credential for another workspace is forbidden", async () => {
    await expect(
      resolveMasterAgentWorkspacePrincipal({
        payload: memberPayload,
        requestedWorkspaceId: "999999999",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
    expect(findWorkspaceAndTokenById).not.toHaveBeenCalled()
    expect(userFindById).not.toHaveBeenCalled()
  })

  test("a token credential resolves the token's own scopes", async () => {
    findWorkspaceAndTokenById.mockResolvedValue({
      workspace: { id: "ws-1", ownerId: "owner-1" },
      apiToken: {
        id: "tok-1",
        workspaceId: "ws-1",
        permission: "read_only",
        scopes: ["broadcasts"],
        isDefault: false,
      },
    })

    const principal = await resolveMasterAgentWorkspacePrincipal({
      payload: tokenPayload,
      requestedWorkspaceId: "ws-1",
    })

    expect(principal.apiToken).toMatchObject({
      id: "tok-1",
      permission: "read_only",
      scopes: ["broadcasts"],
    })
    expect(principal.member).toBeUndefined()
    expect(principal.user).toBeUndefined()
  })

  test("a revoked token is a 401", async () => {
    findWorkspaceAndTokenById.mockResolvedValue(undefined)

    await expect(
      resolveMasterAgentWorkspacePrincipal({
        payload: tokenPayload,
        requestedWorkspaceId: undefined,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHATBOT_TOKEN" })
  })

  test("a superAdmin member resolves with unrestricted scopes", async () => {
    userFindById.mockResolvedValue({ id: "m-1", deletionRequestedAt: null })
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue({
      workspace: { id: "ws-1", ownerId: "owner-1" },
      member: {
        permissions: { superAdmin: true },
      },
    })

    const principal = await resolveMasterAgentWorkspacePrincipal({
      payload: memberPayload,
      requestedWorkspaceId: "ws-1",
    })

    expect(principal.apiToken.scopes).toBeNull()
    expect(principal.member).toBeDefined()
  })

  test("a member without relevant permissions gets no automation scope", async () => {
    userFindById.mockResolvedValue({ id: "m-1", deletionRequestedAt: null })
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue({
      workspace: { id: "ws-1", ownerId: "owner-1" },
      member: {
        permissions: { analytics: true },
      },
    })

    const principal = await resolveMasterAgentWorkspacePrincipal({
      payload: memberPayload,
      requestedWorkspaceId: "ws-1",
    })

    // analytics only — no contacts, no automation, no broadcasts. A scoped
    // public route outside that list is a 403 for this member's turns.
    expect(principal.apiToken.scopes).toEqual([
      "analytics",
      "ads",
      "leaderboards",
    ])
  })

  test("a member with contacts and flows reaches the automation surfaces", async () => {
    userFindById.mockResolvedValue({ id: "m-1", deletionRequestedAt: null })
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue({
      workspace: { id: "ws-1", ownerId: "owner-1" },
      member: {
        permissions: { contacts: true, flows: true, broadcast: true },
      },
    })

    const principal = await resolveMasterAgentWorkspacePrincipal({
      payload: memberPayload,
      requestedWorkspaceId: "ws-1",
    })

    expect(principal.apiToken.scopes).toEqual(
      expect.arrayContaining(["contacts", "automation", "broadcasts"]),
    )
  })

  test("no access at all is forbidden", async () => {
    userFindById.mockResolvedValue({ id: "m-1", deletionRequestedAt: null })
    findMembership.mockResolvedValue(undefined)
    resolveWorkspaceAccess.mockResolvedValue(null)

    await expect(
      resolveMasterAgentWorkspacePrincipal({
        payload: memberPayload,
        requestedWorkspaceId: "ws-1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  test("a deleted user is a 401", async () => {
    userFindById.mockResolvedValue({
      id: "m-1",
      deletionRequestedAt: new Date(),
    })

    await expect(
      resolveMasterAgentWorkspacePrincipal({
        payload: memberPayload,
        requestedWorkspaceId: "ws-1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CHATBOT_TOKEN" })
  })
})

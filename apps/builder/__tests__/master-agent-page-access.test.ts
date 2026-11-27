// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const { getCurrentUserAndTargetWorkspace, notFound } = vi.hoisted(() => ({
  getCurrentUserAndTargetWorkspace: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))

vi.mock("@/lib/auth/utils", () => ({ getCurrentUserAndTargetWorkspace }))

vi.mock("next/navigation", () => ({ notFound }))

// Imports follow the `vi.mock` calls so the mocked modules are in place when
// the guard module loads its dependencies.
const { requireMasterAgentPageAccess } = await import(
  "../src/features/master-agent/lib/access"
)

const accessWith = (permissions: Record<string, boolean>) => ({
  user: { id: "user-1" },
  targetWorkspace: { id: "ws-1" },
  targetWorkspaceMember: { workspaceId: "ws-1", userId: "user-1", permissions },
  isSupportSession: false,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("requireMasterAgentPageAccess", () => {
  test("a caller who is not a member of the workspace is sent to 404", async () => {
    getCurrentUserAndTargetWorkspace.mockResolvedValue(null)

    await expect(requireMasterAgentPageAccess("ws-1")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
  })

  test("any member may open the page — permissions gate the operations, not the chat", async () => {
    // Even a member with zero explicit permissions: the chat itself executes
    // nothing, and the turn's derived scopes already exclude every operation
    // they are not allowed to run.
    const access = accessWith({})
    getCurrentUserAndTargetWorkspace.mockResolvedValue(access)

    await expect(requireMasterAgentPageAccess("ws-1")).resolves.toBe(access)
  })

  test("a member with permissions reaches the page too", async () => {
    const access = accessWith({ broadcast: true, flows: true })
    getCurrentUserAndTargetWorkspace.mockResolvedValue(access)

    await expect(requireMasterAgentPageAccess("ws-1")).resolves.toBe(access)
  })
})

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
  "../src/features/master-agent/lib/require-master-agent-page-access"
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

  test("a member without the broadcasts permission is refused with 403", async () => {
    getCurrentUserAndTargetWorkspace.mockResolvedValue(
      accessWith({ flows: true }),
    )

    await expect(requireMasterAgentPageAccess("ws-1")).rejects.toMatchObject({
      code: "masterAgentForbidden",
      httpStatusCode: 403,
    })
  })

  test("a member without the flows permission is refused with 403", async () => {
    getCurrentUserAndTargetWorkspace.mockResolvedValue(
      accessWith({ broadcast: true }),
    )

    await expect(requireMasterAgentPageAccess("ws-1")).rejects.toMatchObject({
      code: "masterAgentForbidden",
      httpStatusCode: 403,
    })
  })

  test("a super admin passes, like every other permission gate", async () => {
    const access = accessWith({ superAdmin: true })
    getCurrentUserAndTargetWorkspace.mockResolvedValue(access)

    await expect(requireMasterAgentPageAccess("ws-1")).resolves.toBe(access)
  })

  test("a member holding both permissions reaches the chat", async () => {
    const access = accessWith({ broadcast: true, flows: true })
    getCurrentUserAndTargetWorkspace.mockResolvedValue(access)

    await expect(requireMasterAgentPageAccess("ws-1")).resolves.toBe(access)
  })
})

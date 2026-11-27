// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const {
  claimPendingActionForExecution,
  settlePendingActionExecution,
  getPendingAction,
  mintMasterAgentCredential,
  executeOperationShape,
} = vi.hoisted(() => ({
  claimPendingActionForExecution: vi.fn(),
  settlePendingActionExecution: vi.fn(),
  getPendingAction: vi.fn(),
  mintMasterAgentCredential: vi.fn(),
  executeOperationShape: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  masterAgentService: {
    claimPendingActionForExecution,
    settlePendingActionExecution,
    getPendingAction,
  },
  mintMasterAgentCredential,
}))

vi.mock("@inboxos.io/openapi-catalog", () => ({
  executeOperationShape,
}))

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_BUILDER_URL: "https://builder.example.com" },
}))

const { executePendingActionConfirmation } = await import(
  "../src/lib/master-agent/execute-pending-action"
)

const claimedRow = {
  id: "pa-1",
  workspaceId: "ws-1",
  sessionId: "s-1",
  operationId: "broadcasts.schedule",
  args: {
    id: "b-1",
    schedulesType: "once",
    schedulesAt: "2026-11-27T13:00:00Z",
  },
  execution: {
    method: "POST",
    baseUrl: "https://api.example.com",
    pathTemplate: "/v1/broadcasts/{id}/schedule",
    pathParamNames: ["id"],
    queryParamNames: [],
    bodyParamNames: ["schedulesType", "schedulesAt"],
    toolName: "broadcasts_schedule",
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  claimPendingActionForExecution.mockResolvedValue(claimedRow)
  mintMasterAgentCredential.mockResolvedValue("reviewer-jwt")
  executeOperationShape.mockResolvedValue({
    ok: true,
    status: 200,
    contentType: "application/json",
    body: { id: "b-1" },
  })
})

describe("executePendingActionConfirmation", () => {
  test("replays exactly the frozen execution shape with the reviewer's credential", async () => {
    const result = await executePendingActionConfirmation({
      workspaceId: "ws-1",
      actionId: "pa-1",
      memberId: "m-9",
    })

    expect(result).toMatchObject({ id: "pa-1", status: "approved" })
    expect(mintMasterAgentCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        sessionId: "s-1",
        memberId: "m-9",
      }),
    )
    expect(executeOperationShape).toHaveBeenCalledWith(
      {
        method: "POST",
        // The replay always targets this deployment's own public API, never
        // whatever baseUrl a stale spec had when the action was proposed.
        baseUrl: "https://builder.example.com",
        pathTemplate: "/v1/broadcasts/{id}/schedule",
        pathParamNames: ["id"],
        queryParamNames: [],
        bodyParamNames: ["schedulesType", "schedulesAt"],
      },
      claimedRow.args,
      { token: "reviewer-jwt" },
      30_000,
    )
    expect(settlePendingActionExecution).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, actionId: "pa-1" }),
    )
  })

  test("a lost claim race is a conflict — the action can never execute twice", async () => {
    claimPendingActionForExecution.mockResolvedValue(null)
    getPendingAction.mockResolvedValue({ id: "pa-1", status: "approved" })

    await expect(
      executePendingActionConfirmation({
        workspaceId: "ws-1",
        actionId: "pa-1",
        memberId: "m-9",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    expect(executeOperationShape).not.toHaveBeenCalled()
    expect(settlePendingActionExecution).not.toHaveBeenCalled()
  })

  test("an API rejection settles the action as failed, never retried", async () => {
    executeOperationShape.mockResolvedValue({
      ok: false,
      status: 409,
      contentType: "application/json",
      body: { error: "conflict" },
    })

    const result = await executePendingActionConfirmation({
      workspaceId: "ws-1",
      actionId: "pa-1",
      memberId: "m-9",
    })

    expect(result.status).toBe("failed")
    expect(settlePendingActionExecution).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    )
  })

  test("a network failure settles the action as failed too", async () => {
    executeOperationShape.mockRejectedValue(new Error("socket hangup"))

    const result = await executePendingActionConfirmation({
      workspaceId: "ws-1",
      actionId: "pa-1",
      memberId: "m-9",
    })

    expect(result.status).toBe("failed")
    expect(settlePendingActionExecution).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    )
  })
})

import {
  masterAgentService,
  mintMasterAgentCredential,
} from "@inboxos.io/business"
import { notFoundException } from "@inboxos.io/business/errors"
import {
  apiBaseUrlFromBuilderUrl,
  executeOperationShape,
} from "@inboxos.io/openapi-catalog"
import { ORPCError } from "@orpc/server"
import { env } from "@/env"

/**
 * Executes one approved pending action: claims it with the single-winner
 * conditional UPDATE, mints the reviewer's own short-lived credential, and
 * replays the frozen execution shape against this server's public API. The
 * confirm deliberately runs as an ordinary API call: every permission,
 * scope, quota and validation rule the operation enforces applies to it
 * exactly as if the reviewer had made the call themselves.
 */
export const executePendingActionConfirmation = async (input: {
  workspaceId: string
  actionId: string
  memberId?: string | null
  tokenId?: string | null
  viewerMemberId?: string | null
  viewerIsSuperAdmin?: boolean
}): Promise<{ id: string; status: "approved" | "failed"; result: unknown }> => {
  const decidedById = input.memberId ?? null
  const claimed = await masterAgentService.claimPendingActionForExecution({
    workspaceId: input.workspaceId,
    actionId: input.actionId,
    decidedById,
    viewerMemberId: input.viewerMemberId ?? null,
    viewerTokenId: input.tokenId ?? null,
    viewerIsSuperAdmin: input.viewerIsSuperAdmin ?? false,
  })
  if (!claimed) {
    // Either the action does not exist in this workspace (404 semantics) or
    // it was already decided/expired — the conditional UPDATE loses the race
    // in both cases, and re-reading the row is the only way to tell apart a
    // missing row from a lost race. Both reject the same way to the caller.
    const existing = await masterAgentService.getPendingAction({
      workspaceId: input.workspaceId,
      actionId: input.actionId,
    })
    if (!existing) {
      throw notFoundException("Pending action not found")
    }
    throw new ORPCError("CONFLICT", {
      status: 409,
      message:
        "This action was already decided or has expired. Ask the agent for a fresh proposal instead.",
    })
  }

  const credential = await mintMasterAgentCredential({
    workspaceId: input.workspaceId,
    sessionId: claimed.sessionId,
    ...(input.memberId ? { memberId: input.memberId } : {}),
    ...(input.tokenId ? { tokenId: input.tokenId } : {}),
  })

  let ok = false
  let result: unknown
  try {
    const outcome = await executeOperationShape(
      {
        method: claimed.execution.method,
        baseUrl: apiBaseUrlFromBuilderUrl(env.NEXT_PUBLIC_BUILDER_URL),
        pathTemplate: claimed.execution.pathTemplate,
        pathParamNames: claimed.execution.pathParamNames,
        queryParamNames: claimed.execution.queryParamNames,
        bodyParamNames: claimed.execution.bodyParamNames,
      },
      (claimed.args ?? {}) as Record<string, unknown>,
      { token: credential },
      30_000,
    )
    ok = outcome.ok
    result = outcome.ok
      ? outcome.body
      : { error: `Error ${outcome.status}`, body: outcome.body }
  } catch (error) {
    result = {
      error: `Request failed: ${error instanceof Error ? error.message : "unknown error"}`,
    }
  }

  await masterAgentService.settlePendingActionExecution({
    workspaceId: input.workspaceId,
    actionId: input.actionId,
    ok,
    result,
  })
  return {
    id: input.actionId,
    status: ok ? "approved" : "failed",
    result,
  }
}

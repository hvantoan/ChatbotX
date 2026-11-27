import z from "zod"

/**
 * Who wrote one turn of a Master Agent session. `user` is the workspace member
 * (or workspace-token caller); `assistant` is the agent.
 */
export const masterAgentMessageRoles = z.enum(["user", "assistant"])
export type MasterAgentMessageRole = z.infer<typeof masterAgentMessageRoles>

/**
 * Lifecycle of an assistant turn: `pending` while the queued job runs,
 * `completed` once the reply is stored, `failed` when the job could not
 * produce one. User rows are always `completed`.
 */
export const masterAgentMessageStatuses = z.enum([
  "pending",
  "completed",
  "failed",
])
export type MasterAgentMessageStatus = z.infer<
  typeof masterAgentMessageStatuses
>

/**
 * Lifecycle of a Master Agent action waiting on human approval. `pending` is
 * the only state a confirmation can claim — the claim is an UPDATE guarded by
 * `status = 'pending'`, so two confirmers cannot run the action twice.
 * `expired` rows were never executed; `failed` rows were confirmed but the
 * API call itself did not succeed.
 */
export const masterAgentPendingActionStatuses = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "failed",
])
export type MasterAgentPendingActionStatus = z.infer<
  typeof masterAgentPendingActionStatuses
>

/**
 * The confirmation policy of the operation that produced the action, copied
 * from the catalog's `x-mcp.hitlPolicy` when the row is written so a later
 * spec change never retroactively relaxes a stored pending action.
 */
export const masterAgentHitlPolicies = z.enum([
  "confirm_diff",
  "confirm_outbound",
  "confirm_destructive",
])
export type MasterAgentHitlPolicy = z.infer<typeof masterAgentHitlPolicies>

/**
 * The frozen HTTP shape of the catalog operation a pending action replays on
 * confirm, matching `OperationExecutionShape` in
 * `@inboxos.io/openapi-catalog` plus the display `toolName`. Stored verbatim
 * in the row so a later spec change never makes an approved action execute a
 * different call than the reviewer saw.
 */
export type MasterAgentPendingActionExecutionShape = {
  method: string
  baseUrl: string
  pathTemplate: string
  pathParamNames: string[]
  queryParamNames: string[]
  bodyParamNames: string[]
  toolName: string
}

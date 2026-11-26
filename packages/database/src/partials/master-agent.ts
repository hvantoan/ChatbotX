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

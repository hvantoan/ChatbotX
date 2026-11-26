import z from "zod"

/**
 * The one timezone every reminder is written and read in. Vietnam has no DST,
 * so the offset is a constant and no tz database lookup is needed. It lives
 * here rather than in the business service so module-scope tool descriptions
 * can use it without importing the business graph.
 */
export const MASTER_AGENT_TIMEZONE = "Asia/Saigon"

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

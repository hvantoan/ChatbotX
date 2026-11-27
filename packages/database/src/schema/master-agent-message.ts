import { sql } from "drizzle-orm"
import { index, pgEnum, pgTable, text } from "drizzle-orm/pg-core"
import {
  type MasterAgentMessageRole,
  type MasterAgentMessageStatus,
  masterAgentMessageRoles,
  masterAgentMessageStatuses,
} from "../partials/master-agent"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { userModel } from "./auth-user"
import { workspaceModel } from "./workspace"
import { workspaceApiTokenModel } from "./workspace-api-token"

export const masterAgentMessageRole = pgEnum(
  "masterAgentMessageRole",
  masterAgentMessageRoles.options as [
    MasterAgentMessageRole,
    ...MasterAgentMessageRole[],
  ],
)

export const masterAgentMessageStatus = pgEnum(
  "masterAgentMessageStatus",
  masterAgentMessageStatuses.options as [
    MasterAgentMessageStatus,
    ...MasterAgentMessageStatus[],
  ],
)

/**
 * One turn of a Master Agent chat session. `sessionId` groups the turns of a
 * single assistant conversation; it is opaque and always queried together with
 * `workspaceId`, so a session id from another workspace resolves to nothing.
 *
 * An assistant row is inserted as `pending` before the agent job runs and is
 * updated in place when the job finishes, which is what makes the pending turn
 * visible to a client polling the session.
 */
export const masterAgentMessageModel = pgTable(
  "MasterAgentMessage",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sessionId: text().notNull(),
    role: masterAgentMessageRole().notNull(),
    content: text().notNull(),
    status: masterAgentMessageStatus().notNull().default("completed"),
    // A member-owned chat is deleted with that member's account. `set null`
    // would orphan it into an ownerless row, and ownerless rows must fail
    // closed — never become workspace-shared.
    createdById: bigintAsString().references(() => userModel.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    // Token-started sessions bind to the exact workspace API token that
    // created them; another token (or a member) must not read results fetched
    // with this token's scopes just by learning the session id.
    createdByTokenId: bigintAsString().references(
      () => workspaceApiTokenModel.id,
      {
        onDelete: "cascade",
        onUpdate: "cascade",
      },
    ),
  },
  (table) => [
    index("MasterAgentMessage_workspaceId_idx").on(table.workspaceId),
    index("MasterAgentMessage_workspaceId_sessionId_createdAt_id_idx").on(
      table.workspaceId,
      table.sessionId,
      sql`${table.createdAt} ASC`,
      sql`${table.id} ASC`,
    ),
    index("MasterAgentMessage_createdById_idx")
      .on(table.createdById)
      .where(sql`${table.createdById} IS NOT NULL`),
    index("MasterAgentMessage_createdByTokenId_idx")
      .on(table.createdByTokenId)
      .where(sql`${table.createdByTokenId} IS NOT NULL`),
  ],
)

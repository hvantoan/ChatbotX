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
    createdById: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
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
  ],
)

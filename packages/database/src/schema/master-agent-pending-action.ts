import { sql } from "drizzle-orm"
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"
import {
  type MasterAgentHitlPolicy,
  type MasterAgentPendingActionExecutionShape,
  type MasterAgentPendingActionStatus,
  masterAgentHitlPolicies,
  masterAgentPendingActionStatuses,
} from "../partials/master-agent"
import {
  bigintAsString,
  sharedColumns,
  timestampConfig,
} from "../partials/shared"
import { userModel } from "./auth-user"
import { workspaceModel } from "./workspace"

export const masterAgentPendingActionStatus = pgEnum(
  "masterAgentPendingActionStatus",
  masterAgentPendingActionStatuses.options as [
    MasterAgentPendingActionStatus,
    ...MasterAgentPendingActionStatus[],
  ],
)

export const masterAgentHitlPolicy = pgEnum(
  "masterAgentHitlPolicy",
  masterAgentHitlPolicies.options as [
    MasterAgentHitlPolicy,
    ...MasterAgentHitlPolicy[],
  ],
)

/**
 * One public-API operation the Master Agent proposed but is not allowed to run
 * without a human decision. The row is the single source of truth for what
 * executes on confirm: `operationId` + `args` + `execution` are replayed
 * verbatim, never re-asked to the model and never re-resolved against the
 * current spec, so a confirmation cannot silently approve a mutated action and
 * a later spec change never makes a stored approval execute a different call
 * than the reviewer saw. `currentState` is the read-model snapshot the
 * reviewer compares the proposal against.
 *
 * There is no cleanup job: a row goes `expired` lazily, when a reader, a new
 * turn of its session, or a confirm attempt finds it unanswered past
 * `expiresAt`.
 */
export const masterAgentPendingActionModel = pgTable(
  "MasterAgentPendingAction",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sessionId: text().notNull(),
    /** The assistant chat turn that proposed the action. */
    messageId: bigintAsString(),
    /** Catalog operation, e.g. `broadcasts.schedule` — never the snake_case tool name. */
    operationId: text().notNull(),
    args: jsonb().notNull(),
    /** `{ method, pathTemplate, toolName }` — the HTTP replay shape, frozen at write time. */
    execution: jsonb()
      .$type<MasterAgentPendingActionExecutionShape>()
      .notNull(),
    policy: masterAgentHitlPolicy().notNull(),
    /** Read-model snapshot shown to the reviewer next to the proposal. */
    currentState: jsonb(),
    status: masterAgentPendingActionStatus().notNull().default("pending"),
    /** API response (or failure detail) of the confirmed execution. */
    result: jsonb(),
    decidedById: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    decidedAt: timestamp(timestampConfig),
    expiresAt: timestamp(timestampConfig).notNull(),
  },
  (table) => [
    index("MasterAgentPendingAction_workspaceId_idx").on(table.workspaceId),
    index("MasterAgentPendingAction_workspaceId_sessionId_idx").on(
      table.workspaceId,
      table.sessionId,
    ),
    index("MasterAgentPendingAction_messageId_idx")
      .on(table.messageId)
      .where(sql`${table.messageId} IS NOT NULL`),
    index("MasterAgentPendingAction_decidedById_idx")
      .on(table.decidedById)
      .where(sql`${table.decidedById} IS NOT NULL`),
    index("MasterAgentPendingAction_workspaceId_status_idx")
      .on(table.workspaceId, table.status)
      .where(sql`${table.status} = 'pending'`),
  ],
)

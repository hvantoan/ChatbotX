import { sql } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
} from "drizzle-orm/pg-core"
import {
  type AIAgentTrainingMessageRole,
  type AIAgentTrainingProposal,
  aiAgentTrainingMessageRoles,
} from "../partials/ai"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { aiAgentModel } from "./ai-agent"
import { userModel } from "./auth-user"
import { workspaceModel } from "./workspace"

export const aiAgentTrainingMessageRoleEnum = pgEnum(
  "aiAgentTrainingMessageRole",
  aiAgentTrainingMessageRoles.options as [
    AIAgentTrainingMessageRole,
    ...AIAgentTrainingMessageRole[],
  ],
)

export const aiAgentTrainingMessageModel = pgTable(
  "AIAgentTrainingMessage",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    aiAgentId: bigintAsString()
      .notNull()
      .references(() => aiAgentModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    role: aiAgentTrainingMessageRoleEnum().notNull(),
    content: text().notNull(),
    proposal: jsonb().$type<AIAgentTrainingProposal>(),
    appliedVersion: integer(),
    createdById: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("AIAgentTrainingMessage_workspaceId_idx").on(table.workspaceId),
    index("AIAgentTrainingMessage_aiAgentId_createdAt_id_idx").on(
      table.aiAgentId,
      sql`${table.createdAt} DESC`,
      sql`${table.id} DESC`,
    ),
    index("AIAgentTrainingMessage_createdById_idx")
      .on(table.createdById)
      .where(sql`${table.createdById} IS NOT NULL`),
  ],
)

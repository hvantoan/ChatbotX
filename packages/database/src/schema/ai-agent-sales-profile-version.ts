import { sql } from "drizzle-orm"
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import {
  type AIAgentSalesProfile,
  type AIAgentSalesProfileVersionSource,
  aiAgentSalesProfileVersionSources,
} from "../partials/ai"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { aiAgentModel } from "./ai-agent"
import { userModel } from "./auth-user"
import { workspaceModel } from "./workspace"

export const aiAgentSalesProfileVersionSourceEnum = pgEnum(
  "aiAgentSalesProfileVersionSource",
  aiAgentSalesProfileVersionSources.options as [
    AIAgentSalesProfileVersionSource,
    ...AIAgentSalesProfileVersionSource[],
  ],
)

export const aiAgentSalesProfileVersionModel = pgTable(
  "AIAgentSalesProfileVersion",
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
    version: integer().notNull(),
    profile: jsonb().$type<AIAgentSalesProfile>().notNull(),
    source: aiAgentSalesProfileVersionSourceEnum().notNull(),
    instruction: text(),
    createdById: bigintAsString().references(() => userModel.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    uniqueIndex("AIAgentSalesProfileVersion_aiAgentId_version_key").on(
      table.aiAgentId,
      table.version,
    ),
    index("AIAgentSalesProfileVersion_workspaceId_idx").on(table.workspaceId),
    index("AIAgentSalesProfileVersion_aiAgentId_idx").on(table.aiAgentId),
    index("AIAgentSalesProfileVersion_createdById_idx")
      .on(table.createdById)
      .where(sql`${table.createdById} IS NOT NULL`),
  ],
)

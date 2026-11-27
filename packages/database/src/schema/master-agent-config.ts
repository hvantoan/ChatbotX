import { sql } from "drizzle-orm"
import { boolean, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { workspaceModel } from "./workspace"

/**
 * Per-workspace configuration of the Master Agent — deliberately NOT an
 * `AIAgent` row: the Master Agent is a workspace-level operator assistant with
 * its own tool surface (the public API catalog), not a customer-facing chat
 * agent. One row per workspace; a missing row means "never configured" and the
 * worker treats the agent as disabled.
 *
 * `models` shares the `AIAgentProviderModels` shape (provider + model id, or an
 * openai-compatible integration reference): the agent runs on the workspace's
 * connected AI integrations, tried in order like any other agent.
 */
export const masterAgentConfigModel = pgTable(
  "MasterAgentConfig",
  {
    ...sharedColumns,
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    models: jsonb().array().notNull().default(sql`[]`),
    /** Extra instructions appended after the built-in system prompt. */
    prompt: text(),
    enabled: boolean().notNull().default(false),
    /**
     * When true, operations whose hitl policy is `confirm_diff` run without
     * waiting for approval. `confirm_outbound` and `confirm_destructive`
     * always wait — this flag can never relax them.
     */
    autoApproveDiff: boolean().notNull().default(false),
  },
  (table) => [
    uniqueIndex("MasterAgentConfig_workspaceId_key").on(table.workspaceId),
  ],
)

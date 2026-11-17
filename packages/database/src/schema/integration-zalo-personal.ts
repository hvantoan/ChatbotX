import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { bigintAsString, sharedColumns } from "../partials/shared"
import { inboxModel } from "./inbox"
import { workspaceModel } from "./workspace"

export type ZaloPersonalGroupReplyConfig = {
  mode: "all" | "mentions" | "allowlist" | "disabled"
  allowedGroupIds?: string[]
}

export const integrationZaloPersonalModel = pgTable(
  "IntegrationZaloPersonal",
  {
    ...sharedColumns,
    auth: jsonb().$type<{ [x: string]: unknown }>().notNull(),
    zaloUid: text().notNull(),
    name: text().notNull(),
    avatar: text(),
    proxyUrl: text(),
    groupReplyConfig: jsonb().$type<ZaloPersonalGroupReplyConfig>(),
    workspaceId: bigintAsString()
      .notNull()
      .references(() => workspaceModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    inboxId: bigintAsString()
      .notNull()
      .references(() => inboxModel.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    index("IntegrationZaloPersonal_workspaceId_idx").using(
      "btree",
      table.workspaceId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationZaloPersonal_inboxId_key").using(
      "btree",
      table.inboxId.asc().nullsLast(),
    ),
    uniqueIndex("IntegrationZaloPersonal_zaloUid_key").using(
      "btree",
      table.zaloUid.asc().nullsLast(),
    ),
  ],
)

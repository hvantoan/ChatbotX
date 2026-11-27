import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const masterAgentPendingActionRelations = defineRelationsPart(
  schema,
  (r) => ({
    masterAgentPendingActionModel: {
      workspace: r.one.workspaceModel({
        from: r.masterAgentPendingActionModel.workspaceId,
        to: r.workspaceModel.id,
        optional: false,
      }),
      decidedBy: r.one.userModel({
        from: r.masterAgentPendingActionModel.decidedById,
        to: r.userModel.id,
      }),
    },
  }),
)

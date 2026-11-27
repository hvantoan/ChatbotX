import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const masterAgentConfigRelations = defineRelationsPart(schema, (r) => ({
  masterAgentConfigModel: {
    workspace: r.one.workspaceModel({
      from: r.masterAgentConfigModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
  },
}))

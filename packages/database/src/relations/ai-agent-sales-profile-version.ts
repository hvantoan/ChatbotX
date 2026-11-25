import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const aiAgentSalesProfileVersionRelations = defineRelationsPart(
  schema,
  (r) => ({
    aiAgentSalesProfileVersionModel: {
      workspace: r.one.workspaceModel({
        from: r.aiAgentSalesProfileVersionModel.workspaceId,
        to: r.workspaceModel.id,
        optional: false,
      }),
      aiAgent: r.one.aiAgentModel({
        from: r.aiAgentSalesProfileVersionModel.aiAgentId,
        to: r.aiAgentModel.id,
        optional: false,
      }),
      createdBy: r.one.userModel({
        from: r.aiAgentSalesProfileVersionModel.createdById,
        to: r.userModel.id,
      }),
    },
  }),
)

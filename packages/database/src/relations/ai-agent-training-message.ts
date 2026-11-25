import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const aiAgentTrainingMessageRelations = defineRelationsPart(
  schema,
  (r) => ({
    aiAgentTrainingMessageModel: {
      workspace: r.one.workspaceModel({
        from: r.aiAgentTrainingMessageModel.workspaceId,
        to: r.workspaceModel.id,
        optional: false,
      }),
      aiAgent: r.one.aiAgentModel({
        from: r.aiAgentTrainingMessageModel.aiAgentId,
        to: r.aiAgentModel.id,
        optional: false,
      }),
      createdBy: r.one.userModel({
        from: r.aiAgentTrainingMessageModel.createdById,
        to: r.userModel.id,
      }),
    },
  }),
)

import { defineRelationsPart } from "drizzle-orm"
// biome-ignore lint/performance/noNamespaceImport: drizzle schema
import * as schema from "../schema"

export const masterAgentMessageRelations = defineRelationsPart(schema, (r) => ({
  masterAgentMessageModel: {
    workspace: r.one.workspaceModel({
      from: r.masterAgentMessageModel.workspaceId,
      to: r.workspaceModel.id,
      optional: false,
    }),
    broadcast: r.one.broadcastModel({
      from: r.masterAgentMessageModel.broadcastId,
      to: r.broadcastModel.id,
    }),
    createdBy: r.one.userModel({
      from: r.masterAgentMessageModel.createdById,
      to: r.userModel.id,
    }),
  },
}))

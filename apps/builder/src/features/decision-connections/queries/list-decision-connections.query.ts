import { decisionConnectionService } from "@inboxos.io/business"

export const listDecisionConnections = async (workspaceId: string) =>
  await decisionConnectionService.listSafe(workspaceId)

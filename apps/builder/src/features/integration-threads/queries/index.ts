import { integrationThreadsService } from "@inboxos.io/business"

export const listIntegrationThreads = async ({
  workspaceId,
}: {
  workspaceId: string
}) => integrationThreadsService.listByWorkspaceId({ workspaceId })

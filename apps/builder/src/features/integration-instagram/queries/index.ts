import { instagramIntegrationService } from "@inboxos.io/business"
import { findOrFail } from "@inboxos.io/database/client"
import { integrationInstagramModel } from "@inboxos.io/database/schema"
import type { IntegrationInstagramModel } from "@inboxos.io/database/types"

export const findIntegrationInstagram = async (where: {
  workspaceId: string
  id: string
}): Promise<IntegrationInstagramModel> =>
  findOrFail({
    table: integrationInstagramModel,
    where,
  })

export const listIntegrationInstagrams = async ({
  workspaceId,
}: {
  workspaceId: string
}): Promise<{ data: IntegrationInstagramModel[] }> => {
  const data = await instagramIntegrationService.listByWorkspaceId(workspaceId)

  return { data }
}

import { messengerIntegrationService } from "@inboxos.io/business"
import { findOrFail } from "@inboxos.io/database/client"
import { integrationMessengerModel } from "@inboxos.io/database/schema"
import type { IntegrationMessengerModel } from "@inboxos.io/database/types"

export const findIntegrationMessenger = async (
  input: Partial<Pick<IntegrationMessengerModel, "id" | "workspaceId">>,
): Promise<IntegrationMessengerModel> =>
  findOrFail({ table: integrationMessengerModel, where: input })

export const listIntegrationMessengers = async (
  input: Partial<Pick<IntegrationMessengerModel, "id" | "workspaceId">>,
): Promise<{ data: IntegrationMessengerModel[] }> => {
  const data = await messengerIntegrationService.listByWorkspaceIdOrId(input)

  return { data }
}

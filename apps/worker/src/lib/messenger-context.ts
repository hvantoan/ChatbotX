import { buildContext } from "@inboxos.io/business"
import { channelTypes } from "@inboxos.io/database/partials"
import type { IntegrationMessengerModel } from "@inboxos.io/database/types"
import type { MessengerAuthValue } from "@inboxos.io/integration-messenger/schema"

/** Messenger integration context for calling Graph APIs from a worker job. */
export function buildMessengerContext(props: {
  workspaceId: string
  integration: IntegrationMessengerModel
}) {
  const { workspaceId, integration } = props
  return buildContext({
    workspaceId,
    integrationType: channelTypes.enum.messenger,
    integration: {
      ...integration,
      auth: integration.auth as unknown as MessengerAuthValue,
    },
  })
}

import { workspaceService } from "@inboxos.io/business"
import type {
  SelfServeConnectActor,
  SelfServeSecret,
} from "@inboxos.io/business/connection"
import { connectionWrongStrategyException } from "@inboxos.io/business/errors"
import type { IntegrationType } from "@inboxos.io/database/partials"
import type { ConnectionModel } from "@inboxos.io/database/types"
import { resolveAdapter } from "./internal"

export const connectSelfServeChannel = async (input: {
  workspaceId: string
  provider: IntegrationType
  config: Record<string, unknown>
  actor: SelfServeConnectActor
}): Promise<{
  connection: ConnectionModel
  secret: SelfServeSecret | null
}> => {
  const adapter = resolveAdapter(input.provider)
  if (adapter.provider.strategy !== "self_serve" || !adapter.connect) {
    throw connectionWrongStrategyException(input.provider)
  }

  const workspace = await workspaceService.findOrFail({
    where: { id: input.workspaceId },
  })
  const { connection, secret } = await adapter.connect({
    workspaceId: input.workspaceId,
    ownerId: workspace.ownerId,
    actor: input.actor,
    config: input.config,
  })

  return { connection, secret: secret ?? null }
}

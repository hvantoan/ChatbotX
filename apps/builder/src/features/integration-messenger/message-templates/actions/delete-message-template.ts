"use server"

import {
  messengerIntegrationService,
  messengerMessageTemplateService,
} from "@inboxos.io/business"
import { invalidateCacheByTags } from "@inboxos.io/redis"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"

export const deleteMessengerMessageTemplateAction = workspaceActionClient
  .bindArgsSchemas([
    zodBigintAsString(),
    zodBigintAsString(),
    zodBigintAsString(),
  ])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, integrationMessengerId, templateId],
    } = props

    // Verify the integration belongs to the workspace
    const integration = await messengerIntegrationService.findByIdForWorkspace({
      id: integrationMessengerId,
      workspaceId,
    })

    if (!integration) {
      throw new Error("Messenger integration not found")
    }

    await messengerMessageTemplateService.delete({
      id: templateId,
      integrationMessengerId,
    })

    await invalidateCacheByTags([
      `workspaces:${workspaceId}#messenger#messageTemplates`,
    ])
  })

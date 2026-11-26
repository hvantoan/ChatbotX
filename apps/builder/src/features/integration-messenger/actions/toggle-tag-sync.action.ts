"use server"

import { messengerIntegrationService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { z } from "zod"
import { workspaceActionClient } from "@/lib/safe-action"

export const toggleMessengerTagSyncAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(z.object({ enabled: z.boolean() }))
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, integrationId],
      parsedInput: { enabled },
    } = props

    const syncTagEnabledAt = await messengerIntegrationService.updateTagSync({
      workspaceId,
      integrationId,
      enabled,
    })

    return { syncTagEnabledAt }
  })

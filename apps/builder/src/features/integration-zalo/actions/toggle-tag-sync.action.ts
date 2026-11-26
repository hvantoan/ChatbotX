"use server"

import { zaloIntegrationService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { z } from "zod"
import { workspaceActionClient } from "@/lib/safe-action"

export const toggleZaloTagSyncAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(z.object({ enabled: z.boolean() }))
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, integrationId],
      parsedInput: { enabled },
    } = props

    await zaloIntegrationService.updateTagSync({
      workspaceId,
      integrationId,
      enabled,
    })
  })

"use server"

import { templateSyncRequestService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { z } from "zod"
import { installerActionClient } from "./installer-action-client"

export const setInstallationAutoUpdateAction = installerActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(z.object({ autoUpdate: z.boolean() }))
  .action(
    async ({
      ctx: { templateActor },
      bindArgsParsedInputs: [workspaceId, installationId],
      parsedInput,
    }) => {
      await templateSyncRequestService.setAutoUpdate({
        workspaceId,
        installationId,
        actor: templateActor,
        autoUpdate: parsedInput.autoUpdate,
      })
      return { autoUpdate: parsedInput.autoUpdate }
    },
  )

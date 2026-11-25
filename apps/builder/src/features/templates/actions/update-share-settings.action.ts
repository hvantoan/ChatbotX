"use server"

import { templateService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { parseShareExpiry } from "../lib/share-expiry"
import { updateShareSettingsRequest } from "../schema/mutation"
import { templateActionClient } from "./template-action-client"

export const updateShareSettingsAction = templateActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .inputSchema(updateShareSettingsRequest)
  .action(
    async ({
      ctx: { templateActor },
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
    }) => {
      const template = await templateService.updateShareSettings({
        workspaceId,
        templateId: parsedInput.templateId,
        shareEnabled: parsedInput.shareEnabled,
        shareExpiresAt: parseShareExpiry(parsedInput.shareExpiresAt),
        actor: templateActor,
      })
      return {
        shareToken: template.shareToken,
        shareExpiresAt: template.shareExpiresAt,
      }
    },
  )

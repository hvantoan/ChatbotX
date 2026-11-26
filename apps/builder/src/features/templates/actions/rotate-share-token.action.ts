"use server"

import { templateService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { templateActionClient } from "./template-action-client"

export const rotateShareTokenAction = templateActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async ({ ctx: { templateActor }, bindArgsParsedInputs }) => {
    const [workspaceId, templateId] = bindArgsParsedInputs
    const template = await templateService.rotateShareToken({
      workspaceId,
      templateId,
      actor: templateActor,
    })
    return { shareToken: template.shareToken }
  })

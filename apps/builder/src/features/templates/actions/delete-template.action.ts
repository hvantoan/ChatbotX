"use server"

import { templateService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { templateActionClientAllowExpired } from "./template-action-client"

export const deleteTemplateAction = templateActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      ctx: { templateActor },
      bindArgsParsedInputs: [workspaceId, templateId],
    } = props
    await templateService.softDelete({
      workspaceId,
      templateId,
      actor: templateActor,
    })
  })

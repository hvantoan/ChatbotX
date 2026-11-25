"use server"

import { commentAutomationService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"

export const deleteIgCommentAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
    } = props

    await commentAutomationService.deleteInstagram({ workspaceId, id })
  })

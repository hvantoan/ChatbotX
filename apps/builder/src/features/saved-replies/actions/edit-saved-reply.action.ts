"use server"

import { savedReplyService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { editSavedReplyRequest } from "../schema/mutation"

export const editSavedReplyAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()] as const)
  .inputSchema(editSavedReplyRequest)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
      parsedInput,
    } = props

    return await savedReplyService.update(
      { workspaceId, id },
      {
        shortcut: parsedInput.shortcut,
        text: parsedInput.text,
        imageFileIds: parsedInput.imageFileIds,
      },
    )
  })

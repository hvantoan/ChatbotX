"use server"

import { flowVersionService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"

export const revertToPublishedAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, flowId],
    } = props

    const { nodes, edges } = await flowVersionService.revertDraftToPublished({
      workspaceId,
      flowId,
    })

    return { nodes, edges }
  })

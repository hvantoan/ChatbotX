"use server"

import { flowVersionService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { updateDraftFlowVersionSchema } from "../schema/action"

export const updateDraftFlowVersionAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(updateDraftFlowVersionSchema)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
      parsedInput,
    } = props

    await flowVersionService.updateDraft({
      workspaceId,
      id,
      nodes: parsedInput.nodes,
      edges: parsedInput.edges,
    })
    return { ok: true as const }
  })

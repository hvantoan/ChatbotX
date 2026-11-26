"use server"

import { flowService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"

export const duplicateFlowAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(({ bindArgsParsedInputs: [workspaceId, id] }) =>
    flowService.duplicate({ workspaceId, id }),
  )

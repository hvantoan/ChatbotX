"use server"

import { inboxService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { z } from "zod"
import { workspaceActionClient } from "@/lib/safe-action"

export const updateMarkReadOnOutboundAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(z.object({ enabled: z.boolean() }))
  .action(async ({ bindArgsParsedInputs, parsedInput }) => {
    const [workspaceId, id] = bindArgsParsedInputs
    const inbox = await inboxService.updateMarkReadOnOutbound({
      workspaceId,
      id,
      enabled: parsedInput.enabled,
    })
    return { markReadOnOutbound: inbox.markReadOnOutbound }
  })

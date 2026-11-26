"use server"
import { contactService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { requireContactPermissionScope } from "../permissions"

export const unblockContactAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async ({ bindArgsParsedInputs: [workspaceId, id] }) => {
    const accessScope = await requireContactPermissionScope(workspaceId)
    return await contactService.unblockAndRecord({
      workspaceId,
      id,
      accessScope,
    })
  })

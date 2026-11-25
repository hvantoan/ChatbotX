"use server"
import { customFieldService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { bulkUpdateIdsRequest } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
export const deleteFieldsAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .inputSchema(bulkUpdateIdsRequest)
  .action(async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) => {
    await customFieldService.delete({ workspaceId, ids: parsedInput.ids })
  })

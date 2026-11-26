"use server"

import { mediaLibraryService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"

export const deleteMediaLibraryFolderAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(zodBigintAsString())
  .action(async ({ bindArgsParsedInputs, parsedInput: folderId }) => {
    const [workspaceId] = bindArgsParsedInputs
    return await mediaLibraryService.deleteFolder({ workspaceId, folderId })
  })

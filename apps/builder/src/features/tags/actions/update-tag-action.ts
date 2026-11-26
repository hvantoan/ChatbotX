"use server"
import { tagService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { returnValidationErrors } from "next-safe-action"
import { workspaceIdAndIdRequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { updateTagSchema } from "../schema/action"
export const updateTagAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdAndIdRequestParams)
  .inputSchema(updateTagSchema)
  .action(async ({ bindArgsParsedInputs: [workspaceId, id], parsedInput }) => {
    try {
      return await tagService.update({ workspaceId, id }, parsedInput)
    } catch (error) {
      if (error instanceof InboxOSException && error.code === "validation") {
        returnValidationErrors(updateTagSchema, {
          name: { _errors: [error.message] },
        })
      }
      throw error
    }
  })

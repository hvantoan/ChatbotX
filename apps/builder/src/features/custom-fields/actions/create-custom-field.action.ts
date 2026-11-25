"use server"
import { customFieldService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { zodBigintAsString } from "@inboxos.io/utils"
import { returnValidationErrors } from "next-safe-action"
import { workspaceActionClient } from "@/lib/safe-action"
import { createCustomFieldRequest } from "../schema/action"
export const createCustomFieldAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .inputSchema(createCustomFieldRequest)
  .action(async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) => {
    try {
      await customFieldService.create({ workspaceId, data: parsedInput })
    } catch (error) {
      if (error instanceof InboxOSException && error.code === "validation") {
        returnValidationErrors(createCustomFieldRequest, {
          _errors: ["Validation Exception"],
          name: { _errors: [error.message] },
        })
      }
      throw error
    }
  })

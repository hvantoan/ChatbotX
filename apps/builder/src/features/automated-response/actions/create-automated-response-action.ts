"use server"

import { automatedResponseService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { automatedResponseTypes } from "@inboxos.io/database/partials"
import { returnValidationErrors } from "next-safe-action"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { toKeywordRuleMatch } from "../lib/keyword-rule-match"
import { createAutomatedResponseRequest } from "../schema/action"

export const createAutomatedResponseAction = workspaceActionClient
  .bindArgsSchemas([...workspaceIdrequestParams, automatedResponseTypes])
  .inputSchema(createAutomatedResponseRequest)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, type],
      parsedInput,
    } = props

    try {
      await automatedResponseService.create(workspaceId, {
        type,
        text: parsedInput.text,
        flowId: parsedInput.flowId,
        folderId: parsedInput.folderId,
        ...toKeywordRuleMatch(parsedInput),
      })
    } catch (error) {
      if (
        error instanceof InboxOSException &&
        error.code === "validation" &&
        error.field
      ) {
        returnValidationErrors(createAutomatedResponseRequest, {
          _errors: ["Validation Exception"],
          [error.field]: { _errors: [error.message] },
        })
      }
      throw error
    }
  })

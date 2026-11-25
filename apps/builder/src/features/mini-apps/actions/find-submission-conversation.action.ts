"use server"

import { conversationService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { z } from "zod"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

/** Read-only: the conversation to open when a submission's contact is clicked. */
export const findSubmissionConversationAction =
  workspaceActionClientAllowExpired
    .bindArgsSchemas(workspaceIdrequestParams)
    .inputSchema(z.object({ contactId: zodBigintAsString() }))
    .action(async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) => {
      const conversation = await conversationService.findDMByContact({
        workspaceId,
        contactId: parsedInput.contactId,
      })
      return { conversationId: conversation?.id ?? null }
    })

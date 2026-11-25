"use server"

import { magicLinkService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { zodBigintAsString } from "@inboxos.io/utils"
import { returnValidationErrors } from "next-safe-action"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  type UpdateMagicLinkRequest,
  updateMagicLinkRequest,
} from "../schema/action"

export const updateMagicLinkAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(updateMagicLinkRequest)
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
      parsedInput,
    } = props

    return await updateMagicLink(
      {
        workspaceId,
        id,
      },
      parsedInput,
    )
  })

export const updateMagicLink = async (
  ctx: {
    workspaceId: string
    id: string
  },
  parsedInput: UpdateMagicLinkRequest,
) => {
  try {
    await magicLinkService.update({ ...ctx, data: parsedInput })
  } catch (error) {
    if (error instanceof InboxOSException && error.code === "validation") {
      return returnValidationErrors(updateMagicLinkRequest, {
        _errors: ["Validation Exception"],
        name: { _errors: ["Name is already taken"] },
      })
    }

    throw error
  }
}

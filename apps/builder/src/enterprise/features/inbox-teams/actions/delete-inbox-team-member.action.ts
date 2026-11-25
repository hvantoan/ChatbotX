"use server"

import { inboxTeamService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { addInboxTeamMemberRequest } from "../schema/action"

export const deleteTeamMembersAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(addInboxTeamMemberRequest)
  .action(async (props) => {
    const {
      bindArgsClientInputs: [workspaceId, inboxTeamId],
      parsedInput,
    } = props

    await inboxTeamService.removeMembers(
      { workspaceId, inboxTeamId },
      parsedInput.userIds,
    )
  })

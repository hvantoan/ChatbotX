"use server"

import { workspaceMemberService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { zodBigintAsString } from "@inboxos.io/utils"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

export const deleteWorkspaceMemberAction = workspaceActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async (props) => {
    const {
      bindArgsParsedInputs: [workspaceId, id],
    } = props

    const workspaceMember = await workspaceMemberService.findByIdOrFail({
      id,
      workspaceId,
    })

    if (workspaceMember.role === "owner") {
      throw new InboxOSException("You cannot delete the owner of the workspace")
    }

    const currentUserAndTargetChatbot =
      await getCurrentUserAndTargetWorkspace(workspaceId)
    if (!currentUserAndTargetChatbot) {
      throw new InboxOSException(
        "You are not authorized to delete this workspace member",
      )
    }

    const permissions =
      currentUserAndTargetChatbot.targetWorkspaceMember.permissions
    if (!hasWorkspacePermission(permissions, "superAdmin")) {
      throw new InboxOSException(
        "You are not authorized to delete this workspace member. You need to be a super admin to do this.",
      )
    }

    return await workspaceMemberService.delete({ id, workspaceId })
  })

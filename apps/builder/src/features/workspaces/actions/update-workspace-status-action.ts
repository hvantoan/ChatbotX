"use server"

import { workspaceService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import {
  type WorkspaceIdRequestParams,
  workspaceIdrequestParams,
} from "@/features/common/schema"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  type UpdateWorkspaceStatusRequest,
  updateWorkspaceStatusRequest,
} from "../schema/update-workspace-schema"

export const updateWorkspaceStatusAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(updateWorkspaceStatusRequest)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
    }: {
      bindArgsParsedInputs: WorkspaceIdRequestParams
      parsedInput: UpdateWorkspaceStatusRequest
    }) => {
      const currentUserAndTargetWorkspace =
        await getCurrentUserAndTargetWorkspace(workspaceId)
      if (!currentUserAndTargetWorkspace) {
        throw new InboxOSException(
          "You are not authorized to update this workspace",
        )
      }

      const { permissions } =
        currentUserAndTargetWorkspace.targetWorkspaceMember
      if (!hasWorkspacePermission(permissions, "superAdmin")) {
        throw new InboxOSException(
          "You need to be a super admin to change workspace active hours",
        )
      }

      await workspaceService.update({ id: workspaceId, data: parsedInput })
    },
  )

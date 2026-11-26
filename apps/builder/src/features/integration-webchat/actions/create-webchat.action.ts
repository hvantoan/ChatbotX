"use server"

import {
  hasWorkspaceAccess,
  integrationWebchatService,
} from "@inboxos.io/business"
import { auditService } from "@inboxos.io/business/audit"
import { InboxOSException } from "@inboxos.io/business/errors"
import { authActionClient } from "@/lib/safe-action"
import { createWebchatRequest } from "../schema/mutation"

export const createWebchatAction = authActionClient
  .inputSchema(createWebchatRequest)
  .action(async ({ parsedInput, ctx }) => {
    const { authorizedDomains, ...rest } = parsedInput

    if (
      parsedInput.workspaceId &&
      !(await hasWorkspaceAccess({
        workspaceId: parsedInput.workspaceId,
        user: ctx.user,
      }))
    ) {
      throw new InboxOSException("Workspace not found", "notFound", 404)
    }

    const result = await integrationWebchatService.createWithWorkspace({
      workspaceId: parsedInput.workspaceId ?? undefined,
      createdBy: ctx.user.id,
      actorUserId: ctx.user.id,
      workspaceName: parsedInput.name,
      data: {
        ...rest,
        authorizedDomains: authorizedDomains.map((domain) => domain.value),
        auth: {},
        customCss: rest.customCss ?? null,
      },
    })

    if (result.createdWorkspace) {
      await auditService.record({
        userId: ctx.user.id,
        workspaceId: result.workspaceId,
        action: "create",
        detail: `created the workspace (#${result.workspaceId})`,
      })
    }

    return {
      workspaceId: result.workspaceId,
    }
  })

import { masterAgentService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { executePendingActionConfirmation } from "@/lib/master-agent/execute-pending-action"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import {
  getMasterAgentSessionPrivateRequest,
  masterAgentChatSessionResource,
  masterAgentPendingActionIdRequest,
  masterAgentWorkspaceRequest,
  sendMasterAgentMessagePrivateRequest,
  updateMasterAgentConfigPrivateRequest,
} from "../schema/private"
import {
  decideMasterAgentPendingActionResponse,
  masterAgentConfigResource,
  masterAgentPendingActionResource,
} from "../schema/public"

/**
 * Changing the agent's brain (models, prompt, approval mode) is an
 * administrative operation: only members with the flows permission — the
 * section that owns automation in the workspace — may write it. Every member
 * can still chat and review; the public API enforces the real per-operation
 * permissions through the credential scopes.
 */
function requireMasterAgentAdmin(permissions: unknown): void {
  if (!hasWorkspacePermission(permissions as never, "flows")) {
    throw new InboxOSException(
      "You need the flows permission to configure the Master Agent.",
      "masterAgentForbidden",
      403,
    )
  }
}

export const masterAgentPrivateAPIs = {
  sendMasterAgentMessageAPI: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/master-agent/messages",
      summary: "Send message to Master Agent",
      tags: ["Master Agent"],
    })
    .input(sendMasterAgentMessagePrivateRequest)
    .output(masterAgentChatSessionResource)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(
      async ({ context, input }) =>
        await masterAgentService.sendMessage({
          workspaceId: context.workspace.id,
          memberId: context.user.id,
          viewerIsSuperAdmin:
            context.workspaceMember.permissions.superAdmin === true,
          message: input.message,
          sessionId: input.sessionId ?? null,
        }),
    ),

  getMasterAgentSessionAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/master-agent/sessions/{sessionId}",
      summary: "Get Master Agent session",
      tags: ["Master Agent"],
    })
    .input(getMasterAgentSessionPrivateRequest)
    .output(masterAgentChatSessionResource)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(
      async ({ context, input }) =>
        await masterAgentService.getSession({
          workspaceId: context.workspace.id,
          sessionId: input.sessionId,
          viewerMemberId: context.user.id,
          viewerIsSuperAdmin:
            context.workspaceMember.permissions.superAdmin === true,
        }),
    ),

  getMasterAgentConfigAPI: authorizedAPI
    .route({
      method: "GET",
      path: "/workspaces/{workspaceId}/master-agent/config",
      summary: "Get Master Agent configuration",
      tags: ["Master Agent"],
    })
    .input(masterAgentWorkspaceRequest)
    .output(masterAgentConfigResource)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(
      async ({ context }) =>
        await masterAgentService.getConfigView({
          workspaceId: context.workspace.id,
        }),
    ),

  updateMasterAgentConfigAPI: authorizedAPI
    .route({
      method: "PUT",
      path: "/workspaces/{workspaceId}/master-agent/config",
      summary: "Update Master Agent configuration",
      tags: ["Master Agent"],
    })
    .input(updateMasterAgentConfigPrivateRequest)
    .output(masterAgentConfigResource)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      requireMasterAgentAdmin(context.workspaceMember.permissions)
      return await masterAgentService.upsertConfig({
        workspaceId: context.workspace.id,
        enabled: input.enabled,
        autoApproveDiff: input.autoApproveDiff,
        prompt: input.prompt,
        models: input.models,
      })
    }),

  confirmMasterAgentPendingActionAPI: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/master-agent/pending-actions/{actionId}/confirm",
      summary: "Confirm pending Master Agent action",
      tags: ["Master Agent"],
    })
    .input(masterAgentPendingActionIdRequest)
    .output(decideMasterAgentPendingActionResponse)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(
      async ({ context, input }) =>
        await executePendingActionConfirmation({
          workspaceId: context.workspace.id,
          actionId: input.actionId,
          memberId: context.user.id,
        }),
    ),

  rejectMasterAgentPendingActionAPI: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/master-agent/pending-actions/{actionId}/reject",
      summary: "Reject pending Master Agent action",
      tags: ["Master Agent"],
    })
    .input(masterAgentPendingActionIdRequest)
    .output(masterAgentPendingActionResource)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(
      async ({ context, input }) =>
        await masterAgentService.rejectPendingAction({
          workspaceId: context.workspace.id,
          actionId: input.actionId,
          decidedById: context.user.id,
        }),
    ),
}

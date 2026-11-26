import {
  broadcastService,
  type MasterAgentSessionView,
  masterAgentService,
} from "@inboxos.io/business"
import {
  InboxOSException,
  notFoundException,
} from "@inboxos.io/business/errors"
import { broadcastStatuses } from "@inboxos.io/database/partials"
import type { PermissionsInput } from "@/lib/auth/permission-routes"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import { canUseMasterAgent } from "../lib/access"
import {
  confirmMasterAgentDraftRequest,
  confirmMasterAgentDraftResponse,
  getMasterAgentSessionPrivateRequest,
  masterAgentChatSessionResource,
  sendMasterAgentMessagePrivateRequest,
} from "../schema/private"

/**
 * A session's drafts plus the `group:` contact each one targets. Resolved from
 * `listGroups` so the card reads the group name the agent used; a contact that
 * is not a group contact (or was deleted) stays `null` and the card falls back
 * to the draft name.
 */
async function withDraftGroups(
  workspaceId: string,
  session: MasterAgentSessionView,
) {
  if (session.drafts.length === 0) {
    return { ...session, drafts: [] }
  }
  const groups = await masterAgentService.listGroups({ workspaceId })
  const groupsByContactId = new Map(
    groups.map((group) => [
      group.contactId,
      {
        contactId: group.contactId,
        name: group.name,
        sourceId: group.groupSourceId,
      },
    ]),
  )
  return {
    ...session,
    drafts: session.drafts.map((draft) => ({
      ...draft,
      group:
        draft.contactIds
          .map((contactId) => groupsByContactId.get(contactId))
          .find((group) => group !== undefined) ?? null,
    })),
  }
}

/**
 * Master Agent is a broadcast-authoring surface: a member needs `broadcasts`
 * AND `flows` (the draft sends a flow), on every procedure including the
 * confirm step. The service deliberately does not check member permissions.
 */
function requireMasterAgentPermissions(permissions: PermissionsInput): void {
  if (!canUseMasterAgent(permissions)) {
    throw new InboxOSException(
      "You need the broadcasts and flows permissions to use the Master Agent.",
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
    .handler(async ({ context, input }) => {
      requireMasterAgentPermissions(context.workspaceMember.permissions)
      return await withDraftGroups(
        context.workspace.id,
        await masterAgentService.sendMessage({
          workspaceId: context.workspace.id,
          memberId: context.user.id,
          message: input.message,
          sessionId: input.sessionId ?? null,
        }),
      )
    }),

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
    .handler(async ({ context, input }) => {
      requireMasterAgentPermissions(context.workspaceMember.permissions)
      return await withDraftGroups(
        context.workspace.id,
        await masterAgentService.getSession({
          workspaceId: context.workspace.id,
          sessionId: input.sessionId,
        }),
      )
    }),

  /**
   * The only path from a draft to a scheduled broadcast in the UI. It takes no
   * schedule data: the draft's own `schedulesType`/`schedulesAt` are what gets
   * scheduled, exactly like `POST /v1/broadcasts/{id}/schedule` schedules a
   * draft it read from the database.
   */
  confirmMasterAgentDraftAPI: authorizedAPI
    .route({
      method: "POST",
      path: "/workspaces/{workspaceId}/master-agent/drafts/{broadcastId}/confirm",
      summary: "Confirm Master Agent draft",
      tags: ["Master Agent"],
    })
    .input(confirmMasterAgentDraftRequest)
    .output(confirmMasterAgentDraftResponse)
    .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
    .handler(async ({ context, input }) => {
      requireMasterAgentPermissions(context.workspaceMember.permissions)
      const draft = await masterAgentService.getReminder({
        workspaceId: context.workspace.id,
        broadcastId: input.broadcastId,
      })
      if (draft.status !== broadcastStatuses.enum.draft) {
        // Already confirmed, or never a reminder draft: the confirm step is
        // not a second scheduling path for a broadcast the UI did not show.
        throw notFoundException("Draft not found")
      }
      return await broadcastService.scheduleDraft({
        workspaceId: context.workspace.id,
        broadcastId: draft.id,
        schedulesType: draft.schedulesType,
        schedulesAt: draft.schedulesAt,
      })
    }),
}

import { masterAgentService } from "@inboxos.io/business"
import { ORPCError } from "@orpc/server"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { executePendingActionConfirmation } from "@/lib/master-agent/execute-pending-action"
import { mcpSpec } from "@/lib/orpc/mcp-annotations"
import {
  possibleErrorsOnFindingResource,
  possibleErrorsOnMutatingResource,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import {
  decideMasterAgentPendingActionResponse,
  masterAgentActionIdParam,
  masterAgentConfigResource,
  masterAgentSessionIdParam,
  masterAgentSessionResource,
  sendMasterAgentMessageRequest,
  updateMasterAgentConfigRequest,
} from "../schema/public"

// The Master Agent operates the whole workspace; `automation` is the scope
// axis the agent infrastructure itself sits on. The credential the chat mints
// still carries the caller's own scopes — a token restricted to `broadcasts`
// can only ever do broadcast operations through the agent.
const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("automation")

/**
 * Only a genuine workspace API token may seed a token identity. MCP OAuth and
 * master-agent credentials carry synthetic ids (`oauth:<clientId>:<user>`,
 * `master-agent:<session>`) that no `WorkspaceApiToken` row ever matches —
 * minting a turn credential with one would 401 on every catalog call.
 */
const realWorkspaceTokenId = (
  apiToken: { id: string } | undefined,
): string | null => {
  const id = apiToken?.id ?? null
  if (!id || id.includes(":")) {
    return null
  }
  return id
}

/**
 * MCP OAuth callers authenticate as a real user but the middleware folds
 * their identity into the synthetic token id `oauth:<clientId>:<userId>` and
 * never populates `context.user`. The user id is the last segment (ids never
 * contain a colon), so the OAuth caller's turn acts with their member
 * permissions like a UI chat would.
 */
const oauthCallerUserId = (
  apiToken: { id: string } | undefined,
): string | null => {
  const id = apiToken?.id ?? ""
  if (!id.startsWith("oauth:")) {
    return null
  }
  return id.split(":").at(-1) ?? null
}

const TIMEZONE_NOTE = "Times are read as Asia/Saigon."
const APPROVAL_NOTE =
  "Operations that reach members or change data destructively are never executed by the agent itself: they become pending actions a human confirms with `masterAgent.confirmPendingAction`."

export const masterAgentPublicRouter = {
  sendMessage: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/master-agent/messages",
      summary: "Send message to Master Agent",
      description: `Runs one Master Agent turn. The agent operates the workspace through this same public API — contacts, flows, broadcasts, AI agents and everything else the catalog exposes. Returns the whole session with the assistant turn \`pending\` — call \`masterAgent.getSession\` with the returned \`sessionId\` until its \`status\` is \`completed\` or \`failed\`. ${APPROVAL_NOTE} ${TIMEZONE_NOTE}`,
      tags: ["Master Agent"],
      // Sending a message executes nothing by itself — the turn's mutations
      // are individually policy-gated server-side.
      spec: mcpSpec({ visibility: "default", hitlPolicy: "none" }),
    })
    .input(sendMasterAgentMessageRequest)
    .output(masterAgentSessionResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      // A member-driven session (mobile JWT) acts with the member's
      // permissions; a workspace-token chat with the token's scopes.
      return await masterAgentService.sendMessage({
        workspaceId: context.workspace.id,
        memberId: context.user?.id ?? oauthCallerUserId(context.apiToken),
        tokenId: context.user ? null : realWorkspaceTokenId(context.apiToken),
        viewerIsSuperAdmin: context.member?.permissions.superAdmin === true,
        message: input.message,
        sessionId: input.sessionId ?? null,
      })
    }),

  getSession: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/master-agent/sessions/{sessionId}",
      summary: "Get Master Agent session",
      description: `Returns a session's messages and pending actions, scoped to the calling workspace (another workspace's session id is a 404). Use it to poll \`masterAgent.sendMessage\` while \`status\` is \`pending\`. ${TIMEZONE_NOTE}`,
      tags: ["Master Agent"],
      spec: mcpSpec({ visibility: "default" }),
    })
    .input(masterAgentSessionIdParam)
    .output(masterAgentSessionResource)
    .errors(possibleErrorsOnFindingResource)
    .handler(
      async ({ context, input }) =>
        await masterAgentService.getSession({
          workspaceId: context.workspace.id,
          sessionId: input.sessionId,
          viewerMemberId:
            context.user?.id ?? oauthCallerUserId(context.apiToken),
          viewerTokenId: context.user
            ? null
            : realWorkspaceTokenId(context.apiToken),
          viewerIsSuperAdmin: context.member?.permissions.superAdmin === true,
        }),
    ),

  getConfig: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/master-agent/config",
      summary: "Get Master Agent configuration",
      description:
        "Returns the workspace's Master Agent configuration: the provider models it answers with, extra prompt instructions, and the approval mode.",
      tags: ["Master Agent"],
      spec: mcpSpec({ visibility: "hidden" }),
    })
    .output(masterAgentConfigResource)
    .errors(possibleErrorsOnFindingResource)
    .handler(
      async ({ context }) =>
        await masterAgentService.getConfigView({
          workspaceId: context.workspace.id,
        }),
    ),

  updateConfig: workspaceTokenAuthAPI
    .route({
      method: "PUT",
      path: "/v1/master-agent/config",
      summary: "Update Master Agent configuration",
      description:
        "Creates or replaces the workspace's Master Agent configuration. `models` uses the workspace's connected AI integrations in fallback order.",
      tags: ["Master Agent"],
      // Configuration changes are reviewable but not destructive. Hidden from
      // the default MCP set: the chat workflow is send+poll+decide.
      spec: mcpSpec({ visibility: "hidden", hitlPolicy: "confirm_diff" }),
    })
    .input(updateMasterAgentConfigRequest)
    .output(masterAgentConfigResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      // Same gate as the private API: the config steers every member's turns
      // (the prompt is appended to their system prompt) and `autoApproveDiff`
      // switches off human review workspace-wide, so writing it is an
      // automation-admin operation — not something a granular member without
      // the flows permission may do. `context.member` is present for member
      // principals (mobile JWT or a master-agent credential acting as one);
      // OAuth and token callers hold the broad `automation` scope already.
      if (
        context.member &&
        !hasWorkspacePermission(context.member.permissions, "flows")
      ) {
        throw new ORPCError("FORBIDDEN", {
          message:
            "You need the flows permission to configure the Master Agent.",
        })
      }
      return await masterAgentService.upsertConfig({
        workspaceId: context.workspace.id,
        enabled: input.enabled,
        autoApproveDiff: input.autoApproveDiff,
        prompt: input.prompt,
        models: input.models,
      })
    }),

  confirmPendingAction: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/master-agent/pending-actions/{actionId}/confirm",
      summary: "Confirm pending Master Agent action",
      description: `Approves a pending action and executes exactly the operation and arguments the agent proposed — a later spec change can never make a stored approval execute a different call. The execution runs as an ordinary public API call with the confirming caller's permissions. Single-winner: a second confirm of the same action is a conflict, never a second execution. ${APPROVAL_NOTE}`,
      tags: ["Master Agent"],
      spec: mcpSpec({ visibility: "hidden", hitlPolicy: "confirm_diff" }),
    })
    .input(masterAgentActionIdParam)
    .output(decideMasterAgentPendingActionResponse)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const memberId = context.user?.id ?? oauthCallerUserId(context.apiToken)
      return await executePendingActionConfirmation({
        workspaceId: context.workspace.id,
        actionId: input.actionId,
        memberId,
        tokenId: memberId ? null : realWorkspaceTokenId(context.apiToken),
        viewerMemberId: memberId,
        viewerIsSuperAdmin: context.member?.permissions.superAdmin === true,
      })
    }),

  rejectPendingAction: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/master-agent/pending-actions/{actionId}/reject",
      summary: "Reject pending Master Agent action",
      description:
        "Rejects a pending action; it is never executed. Single-winner: rejecting an already-decided action is an error.",
      tags: ["Master Agent"],
      spec: mcpSpec({ visibility: "hidden", hitlPolicy: "confirm_diff" }),
    })
    .input(masterAgentActionIdParam)
    .output(masterAgentSessionResource.shape.pendingActions.element)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const memberId = context.user?.id ?? oauthCallerUserId(context.apiToken)
      return await masterAgentService.rejectPendingAction({
        workspaceId: context.workspace.id,
        actionId: input.actionId,
        decidedById: memberId,
        viewerMemberId: memberId,
        viewerTokenId: memberId ? null : realWorkspaceTokenId(context.apiToken),
        viewerIsSuperAdmin: context.member?.permissions.superAdmin === true,
      })
    }),
}

import z from "zod"
import {
  masterAgentReminderResource,
  masterAgentSessionResource,
} from "./public"

const workspaceScoped = z.object({ workspaceId: z.string().trim().min(1) })

export const sendMasterAgentMessagePrivateRequest = workspaceScoped.extend({
  message: z.string().trim().min(1).max(8000),
  sessionId: z.string().trim().min(1).optional(),
})

export const getMasterAgentSessionPrivateRequest = workspaceScoped.extend({
  sessionId: z.string().trim().min(1),
})

export const confirmMasterAgentDraftRequest = workspaceScoped.extend({
  broadcastId: z.string().trim().min(1),
})

/**
 * The `group:` contact a draft's audience is pinned to, resolved from the
 * workspace's group contacts (`masterAgentService.listGroups`) so the card names
 * the group the same way the agent did instead of showing a bare contact id.
 */
export const masterAgentDraftGroupResource = z.object({
  contactId: z.string(),
  name: z.string(),
  sourceId: z.string(),
})

export const masterAgentDraftResource = masterAgentReminderResource.extend({
  group: masterAgentDraftGroupResource.nullable(),
})

/** The public session shape plus the group each draft targets. */
export const masterAgentChatSessionResource = masterAgentSessionResource.extend(
  {
    drafts: z.array(masterAgentDraftResource),
  },
)

export const confirmMasterAgentDraftResponse = z.object({ id: z.string() })

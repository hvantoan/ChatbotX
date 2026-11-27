import { aiAgentProviderModels } from "@inboxos.io/database/partials"
import z from "zod"
import { masterAgentSessionResource } from "./public"

const workspaceScoped = z.object({ workspaceId: z.string().trim().min(1) })

export const sendMasterAgentMessagePrivateRequest = workspaceScoped.extend({
  message: z.string().trim().min(1).max(8000),
  sessionId: z.string().trim().min(1).optional(),
})

export const getMasterAgentSessionPrivateRequest = workspaceScoped.extend({
  sessionId: z.string().trim().min(1),
})

export const masterAgentWorkspaceRequest = workspaceScoped

export const masterAgentPendingActionIdRequest = workspaceScoped.extend({
  actionId: z.string().trim().min(1),
})

export const updateMasterAgentConfigPrivateRequest = workspaceScoped.extend({
  enabled: z.boolean(),
  autoApproveDiff: z.boolean(),
  prompt: z.string().trim().max(10_000).nullable(),
  models: aiAgentProviderModels,
})

/** The private session resource is the public shape unchanged. */
export const masterAgentChatSessionResource = masterAgentSessionResource

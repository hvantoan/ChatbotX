import {
  aiAgentProviderModels,
  masterAgentHitlPolicies,
  masterAgentMessageRoles,
  masterAgentMessageStatuses,
  masterAgentPendingActionStatuses,
} from "@inboxos.io/database/partials"
import z from "zod"

export const sendMasterAgentMessageRequest = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .max(8000)
    .describe(
      "What the assistant should do, in natural language — e.g. a pasted Zoom summary plus the group name and the reminder time.",
    ),
  sessionId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Chat session to continue. Omit to start a new one; the response returns its `sessionId`.",
    ),
})

export const masterAgentSessionIdParam = z.object({
  sessionId: z
    .string()
    .trim()
    .min(1)
    .describe("Session id returned by `masterAgent.sendMessage`."),
})

export const masterAgentMessageResource = z.object({
  id: z.string(),
  role: masterAgentMessageRoles.describe(
    "`user` for the member's message, `assistant` for the agent's reply.",
  ),
  content: z
    .string()
    .describe("Message text. Empty while an assistant turn is still running."),
  status: masterAgentMessageStatuses.describe(
    "`pending` while the agent runs, then `completed` or `failed`.",
  ),
  createdAt: z.date(),
})

export const masterAgentPendingActionResource = z.object({
  id: z
    .string()
    .describe(
      "Pending action id; confirm or reject it with `masterAgent.confirmPendingAction` / `masterAgent.rejectPendingAction`.",
    ),
  operationId: z
    .string()
    .describe(
      "Catalog operation waiting for approval, e.g. `broadcasts.schedule`.",
    ),
  toolName: z.string(),
  args: z
    .unknown()
    .describe("Exact arguments the agent proposed — confirmed verbatim."),
  policy: masterAgentHitlPolicies.describe(
    "Why approval is required: outbound reach, destructive effect, or a diff review.",
  ),
  currentState: z
    .unknown()
    .nullable()
    .describe(
      "Snapshot of the resource before the change, when a read operation exists; compare it against `args` before deciding.",
    ),
  status: masterAgentPendingActionStatuses.describe(
    "`pending` until a human confirms or rejects it; unclaimed rows expire after 24h or when the session receives a new message.",
  ),
  result: z
    .unknown()
    .nullable()
    .describe(
      "API response of the confirmed execution, or the failure detail.",
    ),
  resourcePath: z
    .string()
    .nullable()
    .describe(
      "Resource hint (`<resource>/<id>`) for opening the resource's edit page in the builder UI; null when the operation names no single resource.",
    ),
  expiresAt: z.date(),
  createdAt: z.date(),
})

export const masterAgentSessionResource = z.object({
  sessionId: z.string(),
  status: masterAgentMessageStatuses.describe(
    "Status of the latest assistant turn: `pending` while it runs.",
  ),
  messages: z.array(masterAgentMessageResource),
  pendingActions: z
    .array(masterAgentPendingActionResource)
    .describe(
      "Actions the agent proposed that are waiting for human approval.",
    ),
})

export type MasterAgentSessionResource = z.infer<
  typeof masterAgentSessionResource
>

export const masterAgentConfigResource = z.object({
  configured: z
    .boolean()
    .describe("False until the workspace saves its first configuration."),
  enabled: z.boolean(),
  autoApproveDiff: z
    .boolean()
    .describe(
      "When true, `confirm_diff` operations run without waiting for approval; outbound and destructive operations always wait.",
    ),
  prompt: z.string().nullable(),
  models: z
    .array(z.unknown())
    .describe("AI provider models the agent uses, in fallback order."),
})

export const updateMasterAgentConfigRequest = z.object({
  enabled: z
    .boolean()
    .describe("Master switch: the agent only answers turns while this is on."),
  autoApproveDiff: z
    .boolean()
    .describe(
      "When true, `confirm_diff` operations run without waiting for approval; outbound and destructive operations always wait.",
    ),
  prompt: z
    .string()
    .trim()
    .max(10_000)
    .nullable()
    .describe(
      "Extra instructions appended after the built-in system prompt. Null clears them.",
    ),
  models: aiAgentProviderModels.describe(
    "AI provider models in fallback order, using the workspace's connected AI integrations.",
  ),
})

export const masterAgentActionIdParam = z.object({
  actionId: z.string().trim().min(1).describe("Pending action id."),
})

export const decideMasterAgentPendingActionResponse = z.object({
  id: z.string(),
  status: masterAgentPendingActionStatuses.describe(
    "`approved` also means the stored call was executed (check `result`); `failed` means the approval ran but the API rejected it.",
  ),
  result: z.unknown().nullable(),
})

import {
  broadcastScheduleTypes,
  broadcastStatuses,
  masterAgentMessageRoles,
  masterAgentMessageStatuses,
} from "@chatbotx.io/database/partials"
import z from "zod"

export const sendMasterAgentMessageRequest = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .max(8000)
    .describe(
      "What the assistant should do, e.g. a pasted Zoom summary plus the group name and the reminder time.",
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
  broadcastId: z
    .string()
    .nullable()
    .describe("Draft reminder this turn created, when a tool created one."),
  createdAt: z.date(),
})

export const masterAgentReminderResource = z.object({
  id: z
    .string()
    .describe("Broadcast id; confirm it with `broadcasts.schedule`."),
  name: z.string(),
  status: broadcastStatuses.describe(
    "A reminder drafted by the agent stays `draft` until a member confirms it.",
  ),
  schedulesType: broadcastScheduleTypes,
  schedulesAt: z.date().describe("Send time (read as Asia/Saigon wall clock)."),
  flowId: z
    .string()
    .nullable()
    .describe("Flow whose message the reminder sends."),
  contactIds: z
    .array(z.string())
    .describe("Contacts the audience is pinned to (the group contact)."),
})

export const masterAgentSessionResource = z.object({
  sessionId: z.string(),
  status: masterAgentMessageStatuses.describe(
    "Status of the latest assistant turn: `pending` while it runs.",
  ),
  messages: z.array(masterAgentMessageResource),
  drafts: z
    .array(masterAgentReminderResource)
    .describe("Reminder drafts linked to this session's turns."),
})

export type MasterAgentSessionResource = z.infer<
  typeof masterAgentSessionResource
>

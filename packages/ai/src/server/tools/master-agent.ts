import { MASTER_AGENT_TIMEZONE, masterAgentService } from "@inboxos.io/business"
import { type ToolSet, tool } from "ai"
import { z } from "zod"

/**
 * The complete tool surface of the Master Agent: six tools, the three read-only
 * lookups (`listGroups`, `listFlows`, `listReminders`) plus the three reminder
 * actions. There is deliberately no `schedule`, `sendNow`, or `delete` tool: a
 * reminder leaves `draft` only when a member confirms it in the UI, so the
 * agent cannot make anything reach a customer on its own.
 */
export const masterAgentToolNames = [
  "listGroups",
  "listFlows",
  "listReminders",
  "draftReminder",
  "updateReminderDraft",
  "stopReminder",
] as const

export type MasterAgentToolName = (typeof masterAgentToolNames)[number]

export type MasterAgentToolContext = {
  workspaceId: string
  /** Chat session the turn belongs to; kept for auditing a tool call. */
  sessionId: string
  /** The pending assistant row this turn fills in; a created draft links to it. */
  messageId: string
}

const reminderShape = {
  broadcastId: z
    .string()
    .min(1)
    .describe("Reminder broadcast id. Get it from `listReminders`."),
}

/**
 * The six tools, each a thin call into `masterAgentService`. They run inside
 * the worker process against the workspace directly — never over HTTP and
 * never with a workspace token — so the agent has no credential at all.
 */
export function getMasterAgentTools(context: MasterAgentToolContext): ToolSet {
  const { workspaceId, messageId } = context
  // Built per call, not at module scope: the timezone comes from the business
  // package, which tests mock partially, and a module-scope read of a mocked
  // module throws on import.
  const scheduledAtSchema = z
    .string()
    .min(1)
    .describe(
      `Send time as the user wrote it, in ${MASTER_AGENT_TIMEZONE}: "YYYY-MM-DD HH:mm".`,
    )

  return {
    listGroups: tool({
      description:
        "List the workspace's group contacts (course groups such as K3/K4/K5). Use it to resolve the group named in the user's summary to a `contactId`; never guess an id.",
      inputSchema: z.object({}),
      execute: async () => await masterAgentService.listGroups({ workspaceId }),
    }),

    listFlows: tool({
      description:
        "List the workspace's published flows with their id and name. Use it to pick the flow that sends the reminder and pass its id as `flowId`; never guess a flow id.",
      inputSchema: z.object({}),
      execute: async () => await masterAgentService.listFlows({ workspaceId }),
    }),

    listReminders: tool({
      description:
        "List the workspace's reminder broadcasts with their status (draft, scheduled, recurring, cancelled) and send time. Use it before updating or stopping one.",
      inputSchema: z.object({}),
      execute: async () =>
        await masterAgentService.listReminders({ workspaceId }),
    }),

    draftReminder: tool({
      description:
        "Create a DRAFT reminder broadcast for one group contact. It does not schedule or send anything: the user reviews the draft and confirms it themselves. Use `listGroups` for `contactId` and `listFlows` for `flowId`.",
      inputSchema: z.object({
        contactId: z
          .string()
          .min(1)
          .describe("Group contact id, from `listGroups`."),
        flowId: z
          .string()
          .min(1)
          .describe(
            "Id of the flow whose message the reminder sends, from `listFlows` (a broadcast sends a flow, not free text).",
          ),
        name: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Draft name shown in the broadcast list, e.g. 'Nhắc lịch K5'.",
          ),
        scheduledAt: scheduledAtSchema,
      }),
      execute: async (args) =>
        await masterAgentService.draftReminder({
          workspaceId,
          messageId,
          contactId: args.contactId,
          flowId: args.flowId,
          name: args.name ?? null,
          scheduledAt: args.scheduledAt,
        }),
    }),

    updateReminderDraft: tool({
      description:
        "Edit a DRAFT reminder (group, flow, name, or send time). Only a draft can be edited; a scheduled reminder must be stopped first.",
      inputSchema: z.object({
        ...reminderShape,
        contactId: z
          .string()
          .min(1)
          .optional()
          .describe("New group contact id, from `listGroups`."),
        flowId: z
          .string()
          .min(1)
          .optional()
          .describe("New flow id for the reminder message, from `listFlows`."),
        name: z.string().min(1).optional().describe("New draft name."),
        scheduledAt: scheduledAtSchema.optional(),
      }),
      execute: async (args) =>
        await masterAgentService.updateReminderDraft({
          workspaceId,
          messageId,
          broadcastId: args.broadcastId,
          contactId: args.contactId ?? null,
          flowId: args.flowId ?? null,
          name: args.name ?? null,
          scheduledAt: args.scheduledAt ?? null,
        }),
    }),

    stopReminder: tool({
      description:
        "Stop or pause an existing reminder. A scheduled one moves back to draft; a sending or recurring one is stopped.",
      inputSchema: z.object(reminderShape),
      execute: async (args) =>
        await masterAgentService.stopReminder({
          workspaceId,
          broadcastId: args.broadcastId,
        }),
    }),
  }
}

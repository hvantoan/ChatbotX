import { and, asc, db, eq, like } from "@inboxos.io/database/client"
import {
  type BroadcastScheduleType,
  type BroadcastStatus,
  type BroadcastSubaction,
  broadcastScheduleTypes,
  broadcastStatuses,
  type ChannelType,
  type MasterAgentMessageRole,
  type MasterAgentMessageStatus,
  masterAgentMessageRoles,
  masterAgentMessageStatuses,
  normalizeBroadcastSendLimit,
} from "@inboxos.io/database/partials"
import type { ContactFilterCriteriaInput } from "@inboxos.io/database/queries"
import {
  contactInboxModel,
  contactModel,
  inboxModel,
  masterAgentMessageModel,
} from "@inboxos.io/database/schema"
import { createId } from "@inboxos.io/utils"
import { AIJobAction, aiAgentQueue } from "@inboxos.io/worker-config"
import { broadcastService } from "../broadcast"
import { notFoundException, validationException } from "../errors"

/**
 * The one timezone every reminder is written and read in. Vietnam has no DST,
 * so the offset is a constant and no tz database lookup is needed.
 */
export const MASTER_AGENT_TIMEZONE = "Asia/Saigon"
const ASIA_SAIGON_OFFSET = "+07:00"
/** A bare wall-clock time: `YYYY-MM-DD HH:mm[:ss]` with a space or `T`. */
const SAIGON_WALL_CLOCK_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/

const SESSION_MESSAGE_LIMIT = 200
const REMINDER_LIST_LIMIT = 25
const GROUP_LIST_LIMIT = 200

/**
 * Statuses the assistant may act on. `sending` is included because
 * `stopReminder` can stop an in-flight broadcast, which means the agent must be
 * able to discover its id from `listReminders`.
 */
const reminderStatuses: readonly BroadcastStatus[] = [
  broadcastStatuses.enum.draft,
  broadcastStatuses.enum.scheduled,
  broadcastStatuses.enum.recurring,
  broadcastStatuses.enum.sending,
  broadcastStatuses.enum.cancelled,
]

/** The built-in prompt; a workspace agent's own prompt wins when it has one. */
export const MASTER_AGENT_DEFAULT_PROMPT = [
  "You are the Master Agent, an assistant that turns a pasted Zoom summary into a reminder broadcast for a course group.",
  "Answer in the language the user writes in.",
  "Never schedule or send anything. Use `listGroups` to resolve the group by name, `draftReminder` to create the DRAFT, and `updateReminderDraft` for corrections; the user confirms the draft in the UI.",
  `Always state the send time in ${MASTER_AGENT_TIMEZONE} (24h, dd/MM/yyyy HH:mm).`,
].join("\n")

export type MasterAgentMessageView = {
  id: string
  role: MasterAgentMessageRole
  content: string
  status: MasterAgentMessageStatus
  broadcastId: string | null
  createdAt: Date
}

/** A reminder broadcast as the chat and the agent see it. */
export type MasterAgentReminderView = {
  id: string
  name: string
  status: BroadcastStatus
  schedulesType: BroadcastScheduleType
  /** Send time, read as `Asia/Saigon` wall-clock time. */
  schedulesAt: Date
  flowId: string | null
  /** Contacts the audience is pinned to (`contactId` filter conditions). */
  contactIds: string[]
}

export type MasterAgentSessionView = {
  sessionId: string
  status: MasterAgentMessageStatus
  messages: MasterAgentMessageView[]
  drafts: MasterAgentReminderView[]
}

/**
 * `field: "contactId"` conditions are how a system-generated audience pins
 * itself to one contact; see `buildContactFilterForContact`.
 */
export const buildContactFilterForContact = (
  contactId: string,
): ContactFilterCriteriaInput => ({
  operator: "and",
  conditions: [
    { field: "contactId", operator: "eq", value: contactId },
    // A group contact has no DM, so the default DM requirement would drop it
    // from the audience; "Last interaction" (either state) selects by chat
    // history instead, which is what the send path uses to open the DM.
    { field: "lastInteraction", operator: "isNotEmpty" },
  ],
})

const readAudienceContactIds = (
  contactFilter: ContactFilterCriteriaInput | null | undefined,
): string[] =>
  (contactFilter?.conditions ?? []).flatMap((condition) => {
    if (!condition || typeof condition !== "object") {
      return []
    }
    if (!("field" in condition) || condition.field !== "contactId") {
      return []
    }
    const raw = "value" in condition ? condition.value : undefined
    const values = Array.isArray(raw) ? raw : [raw]
    return values.filter((value): value is string => typeof value === "string")
  })

/**
 * Parses a wall-clock time the caller wrote in `Asia/Saigon`. Accepts
 * `YYYY-MM-DD HH:mm[:ss]` (the shape a chat writes) or any string `Date`
 * understands; a bare wall-clock time is read as +07:00, never as server-local
 * time.
 */
export function parseAsiaSaigonDateTime(value: string): Date {
  const trimmed = value.trim()
  const wallClock = SAIGON_WALL_CLOCK_PATTERN.test(trimmed)
  const parsed = new Date(
    wallClock ? `${trimmed.replace(" ", "T")}${ASIA_SAIGON_OFFSET}` : trimmed,
  )
  if (Number.isNaN(parsed.getTime())) {
    throw validationException(
      "scheduledAt",
      `Invalid send time. Use YYYY-MM-DD HH:mm in ${MASTER_AGENT_TIMEZONE}.`,
    )
  }
  return parsed
}

class MasterAgentService {
  /**
   * Records the user's turn, queues the agent job, and returns the session as
   * it now stands (the assistant row is `pending`). Both the public API and the
   * builder's private API call this; the job only carries ids, so the consumer
   * reads the same rows.
   */
  async sendMessage(input: {
    workspaceId: string
    memberId?: string | null
    message: string
    sessionId?: string | null
  }): Promise<MasterAgentSessionView> {
    const content = input.message.trim()
    if (!content) {
      throw validationException("message", "Message must not be empty.")
    }

    const requestedSessionId = input.sessionId?.trim() || null
    if (requestedSessionId) {
      const existing = await db.query.masterAgentMessageModel.findFirst({
        where: {
          workspaceId: input.workspaceId,
          sessionId: requestedSessionId,
        },
        columns: { id: true },
      })
      if (!existing) {
        throw notFoundException("Session not found")
      }
    }
    const sessionId = requestedSessionId ?? createId()

    const createdById = input.memberId ?? null
    const [, assistant] = await db.transaction(async (tx) => {
      const userMessage = await tx
        .insert(masterAgentMessageModel)
        .values({
          workspaceId: input.workspaceId,
          sessionId,
          role: masterAgentMessageRoles.enum.user,
          content,
          status: masterAgentMessageStatuses.enum.completed,
          createdById,
        })
        .returning({ id: masterAgentMessageModel.id })
      const pending = await tx
        .insert(masterAgentMessageModel)
        .values({
          workspaceId: input.workspaceId,
          sessionId,
          role: masterAgentMessageRoles.enum.assistant,
          content: "",
          status: masterAgentMessageStatuses.enum.pending,
          createdById,
        })
        .returning({ id: masterAgentMessageModel.id })
      return [userMessage[0], pending[0]]
    })

    await aiAgentQueue.add(
      AIJobAction.processMasterAgent,
      {
        type: AIJobAction.processMasterAgent,
        data: {
          workspaceId: input.workspaceId,
          sessionId,
          messageId: assistant.id,
        },
      },
      // Deterministic per turn: a retried request cannot double-run one reply.
      { jobId: `master-agent-${assistant.id}` },
    )

    return await this.getSession({ workspaceId: input.workspaceId, sessionId })
  }

  /** Session history with its drafts. Unknown session or foreign workspace → 404. */
  async getSession(input: {
    workspaceId: string
    sessionId: string
  }): Promise<MasterAgentSessionView> {
    const rows = await db.query.masterAgentMessageModel.findMany({
      where: {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
      },
      orderBy: {
        // Newest window first so a long session keeps its latest turns; the
        // list is reversed back into reading order below.
        createdAt: "desc",
        id: "desc",
      },
      limit: SESSION_MESSAGE_LIMIT,
    })
    rows.reverse()

    if (rows.length === 0) {
      throw notFoundException("Session not found")
    }

    const messages: MasterAgentMessageView[] = rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      status: row.status,
      broadcastId: row.broadcastId,
      createdAt: row.createdAt,
    }))
    const lastAssistant = [...messages]
      .reverse()
      .find(
        (message) => message.role === masterAgentMessageRoles.enum.assistant,
      )

    return {
      sessionId: input.sessionId,
      status:
        lastAssistant?.status ?? masterAgentMessageStatuses.enum.completed,
      messages,
      drafts: await this.draftsOf(
        input.workspaceId,
        rows.flatMap((row) => (row.broadcastId ? [row.broadcastId] : [])),
      ),
    }
  }

  /**
   * Fills in the pending assistant row. Called by the worker consumer with the
   * agent's final text; `status` is `failed` when the run produced nothing.
   */
  async completeTurn(input: {
    workspaceId: string
    messageId: string
    content: string
    status?: Extract<MasterAgentMessageStatus, "completed" | "failed">
  }): Promise<void> {
    await db
      .update(masterAgentMessageModel)
      .set({
        content: input.content,
        status: input.status ?? masterAgentMessageStatuses.enum.completed,
      })
      .where(
        and(
          eq(masterAgentMessageModel.id, input.messageId),
          eq(masterAgentMessageModel.workspaceId, input.workspaceId),
          eq(
            masterAgentMessageModel.role,
            masterAgentMessageRoles.enum.assistant,
          ),
        ),
      )
  }

  /** Points the running turn at the draft broadcast one of its tools created. */
  async linkDraft(input: {
    workspaceId: string
    messageId: string
    broadcastId: string
  }): Promise<void> {
    await db
      .update(masterAgentMessageModel)
      .set({ broadcastId: input.broadcastId })
      .where(
        and(
          eq(masterAgentMessageModel.id, input.messageId),
          eq(masterAgentMessageModel.workspaceId, input.workspaceId),
        ),
      )
  }

  /**
   * Group contacts of the workspace, discovered through their
   * `group:`-prefixed channel identity — a new course group needs no code
   * change here, only the contact to exist.
   */
  async listGroups(input: { workspaceId: string }): Promise<
    Array<{
      contactId: string
      name: string
      groupSourceId: string
      inboxId: string
      inboxName: string
      channel: string
    }>
  > {
    const rows = await db
      .select({
        contactId: contactModel.id,
        fullName: contactModel.fullName,
        email: contactModel.email,
        sourceId: contactInboxModel.sourceId,
        inboxId: contactInboxModel.inboxId,
        inboxName: inboxModel.name,
        channel: contactInboxModel.channel,
      })
      .from(contactInboxModel)
      .innerJoin(contactModel, eq(contactModel.id, contactInboxModel.contactId))
      .innerJoin(inboxModel, eq(inboxModel.id, contactInboxModel.inboxId))
      .where(
        and(
          eq(contactModel.workspaceId, input.workspaceId),
          like(contactInboxModel.sourceId, "group:%"),
        ),
      )
      .orderBy(asc(contactInboxModel.sourceId))
      .limit(GROUP_LIST_LIMIT)

    return rows.map((row) => ({
      contactId: row.contactId,
      name: row.fullName ?? row.email ?? row.sourceId,
      groupSourceId: row.sourceId,
      inboxId: row.inboxId,
      inboxName: row.inboxName,
      channel: row.channel,
    }))
  }

  /** Reminder broadcasts of the workspace, newest schedule first. */
  async listReminders(input: {
    workspaceId: string
  }): Promise<MasterAgentReminderView[]> {
    // The status filter is part of the query, not applied after the limit:
    // filtering afterwards let unrelated statuses (`sent`, `failed`) consume
    // the 25 slots and hid the reminders the agent could actually act on.
    const rows = await db.query.broadcastModel.findMany({
      where: {
        workspaceId: input.workspaceId,
        deletedAt: { isNull: true },
        status: { in: [...reminderStatuses] },
      },
      orderBy: { schedulesAt: "desc", id: "desc" },
      limit: REMINDER_LIST_LIMIT,
    })

    return rows.map((row) => this.toReminderView(row))
  }

  /** One reminder, scoped to the workspace. Unknown id → 404. */
  async getReminder(input: {
    workspaceId: string
    broadcastId: string
  }): Promise<MasterAgentReminderView> {
    const broadcast = await broadcastService.findByIdOrName({
      workspaceId: input.workspaceId,
      idOrName: input.broadcastId,
    })
    return this.toReminderView(broadcast)
  }

  /**
   * Creates the reminder as a DRAFT aimed at one group contact. Deliberately
   * cannot schedule or send: `schedulesType: "future"` + `saveAsDraft` keeps
   * the broadcast in `draft` until a member confirms it in the UI.
   */
  async draftReminder(input: {
    workspaceId: string
    messageId?: string | null
    contactId: string
    flowId: string
    name?: string | null
    scheduledAt: string
  }): Promise<MasterAgentReminderView> {
    // One reminder per turn: the turn row carries a single `broadcastId`, so a
    // second draft would silently replace the first in the session view. The
    // agent is told to edit the draft it already created instead.
    if (input.messageId) {
      const turn = await db.query.masterAgentMessageModel.findFirst({
        where: {
          id: input.messageId,
          workspaceId: input.workspaceId,
        },
        columns: { broadcastId: true },
      })
      if (turn?.broadcastId) {
        throw validationException(
          "messageId",
          "This turn already drafted a reminder. Change it with updateReminderDraft, or ask for a new turn.",
        )
      }
    }

    await this.assertGroupContact({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
    })

    const broadcast = await broadcastService.create({
      workspaceId: input.workspaceId,
      canViewEmailAndPhone: true,
      channel: "omnichannel",
      subaction: "allContacts",
      flowId: input.flowId,
      schedulesType: broadcastScheduleTypes.enum.future,
      schedulesAt: parseAsiaSaigonDateTime(input.scheduledAt).toISOString(),
      contactFilter: buildContactFilterForContact(input.contactId),
      saveAsDraft: true,
    })

    const reminder = input.name?.trim()
      ? await this.renameDraft(input.workspaceId, broadcast.id, input.name)
      : this.toReminderView(broadcast)

    if (input.messageId) {
      await this.linkDraft({
        workspaceId: input.workspaceId,
        messageId: input.messageId,
        broadcastId: broadcast.id,
      })
    }
    return reminder
  }

  /**
   * Edits a draft reminder in place. Only `draft` broadcasts match, so an
   * already-scheduled reminder cannot be rewritten behind the confirm step.
   */
  async updateReminderDraft(input: {
    workspaceId: string
    messageId?: string | null
    broadcastId: string
    contactId?: string | null
    flowId?: string | null
    name?: string | null
    scheduledAt?: string | null
  }): Promise<MasterAgentReminderView> {
    const existing = await broadcastService.findByIdOrName({
      workspaceId: input.workspaceId,
      idOrName: input.broadcastId,
    })
    if (existing.status !== broadcastStatuses.enum.draft) {
      throw validationException(
        "broadcastId",
        "Only a draft reminder can be edited.",
      )
    }

    const contactId =
      input.contactId ??
      readAudienceContactIds(
        existing.contactFilter as ContactFilterCriteriaInput | null,
      )[0]
    if (input.contactId) {
      await this.assertGroupContact({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
      })
    }

    const flowId = input.flowId ?? existing.flowId
    if (!flowId) {
      throw validationException(
        "flowId",
        "The reminder has no flow; choose the flow that sends the reminder.",
      )
    }

    await broadcastService.updateDraft({
      workspaceId: input.workspaceId,
      broadcastId: existing.id,
      canViewEmailAndPhone: true,
      data: {
        channel: existing.channel as ChannelType,
        subaction: existing.subaction as BroadcastSubaction,
        // `updateDraft` replaces the whole payload, so an omitted range/rate
        // would reset to "everyone". Carry the stored limits through an edit
        // the tool does not touch them in.
        ...normalizeBroadcastSendLimit(existing),
        flowId,
        schedulesType: broadcastScheduleTypes.enum.future,
        schedulesAt: input.scheduledAt
          ? parseAsiaSaigonDateTime(input.scheduledAt).toISOString()
          : existing.schedulesAt.toISOString(),
        contactFilter: contactId
          ? buildContactFilterForContact(contactId)
          : (existing.contactFilter as ContactFilterCriteriaInput | null),
        saveAsDraft: true,
      },
    })

    const reminder = input.name?.trim()
      ? await this.renameDraft(input.workspaceId, existing.id, input.name)
      : await this.getReminder({
          workspaceId: input.workspaceId,
          broadcastId: existing.id,
        })

    if (input.messageId) {
      // Editing an older draft keeps the turn's own draft as the one the chat
      // returns; only a turn without one adopts the edited draft.
      const turn = await db.query.masterAgentMessageModel.findFirst({
        where: {
          id: input.messageId,
          workspaceId: input.workspaceId,
        },
        columns: { broadcastId: true },
      })
      if (!turn?.broadcastId) {
        await this.linkDraft({
          workspaceId: input.workspaceId,
          messageId: input.messageId,
          broadcastId: existing.id,
        })
      }
    }
    return reminder
  }

  /**
   * Stops a reminder: a scheduled one goes back to `draft` (the only status a
   * pending send can be pulled from without cancelling it permanently), a
   * sending or paused one is stopped. A draft has nothing to stop.
   */
  async stopReminder(input: {
    workspaceId: string
    broadcastId: string
  }): Promise<MasterAgentReminderView> {
    const existing = await broadcastService.findByIdOrName({
      workspaceId: input.workspaceId,
      idOrName: input.broadcastId,
    })

    switch (existing.status) {
      case broadcastStatuses.enum.draft:
        throw validationException(
          "broadcastId",
          "The reminder is still a draft; nothing is scheduled to stop.",
        )
      case broadcastStatuses.enum.scheduled:
        await broadcastService.moveToDraft({
          workspaceId: input.workspaceId,
          broadcastId: existing.id,
        })
        break
      case broadcastStatuses.enum.recurring:
      case broadcastStatuses.enum.cancelled:
      case broadcastStatuses.enum.sending:
        await broadcastService.stopSending({
          workspaceId: input.workspaceId,
          broadcastId: existing.id,
        })
        break
      default:
        throw validationException(
          "broadcastId",
          "This broadcast is not a reminder that can be stopped.",
        )
    }

    return await this.getReminder({
      workspaceId: input.workspaceId,
      broadcastId: existing.id,
    })
  }

  /**
   * The workspace agent that runs Master Agent turns: a non-default agent (it
   * must never answer a customer DM), oldest first so the configured one stays
   * the same turn to turn.
   */
  async resolveAgent(workspaceId: string) {
    return await db.query.aiAgentModel.findFirst({
      where: { workspaceId, isDefault: false },
      orderBy: { createdAt: "asc", id: "asc" },
    })
  }

  private async renameDraft(
    workspaceId: string,
    broadcastId: string,
    name: string,
  ): Promise<MasterAgentReminderView> {
    await broadcastService.update(
      { workspaceId, id: broadcastId },
      { name: name.trim() },
    )
    return await this.getReminder({ workspaceId, broadcastId })
  }

  /**
   * A reminder targets a group contact: the contact must belong to the
   * workspace and carry a `group:`-prefixed channel identity. Without the
   * second check a tool call could aim a course reminder at one customer's DM.
   */
  private async assertGroupContact(input: {
    workspaceId: string
    contactId: string
  }): Promise<void> {
    const contact = await db.query.contactModel.findFirst({
      where: { id: input.contactId, workspaceId: input.workspaceId },
      columns: { id: true },
    })
    if (!contact) {
      throw notFoundException("Group contact not found")
    }

    const groupInbox = await db.query.contactInboxModel.findFirst({
      where: { contactId: input.contactId, sourceId: { like: "group:%" } },
      columns: { id: true },
    })
    if (!groupInbox) {
      throw validationException(
        "contactId",
        "That contact is not a group contact.",
      )
    }
  }

  private async draftsOf(
    workspaceId: string,
    broadcastIds: string[],
  ): Promise<MasterAgentReminderView[]> {
    if (broadcastIds.length === 0) {
      return []
    }
    const rows = await db.query.broadcastModel.findMany({
      where: {
        workspaceId,
        id: { in: [...new Set(broadcastIds)] },
        deletedAt: { isNull: true },
      },
      orderBy: { createdAt: "desc" },
    })
    return rows.map((row) => this.toReminderView(row))
  }

  private toReminderView(row: {
    id: string
    name: string
    status: string
    schedulesType: string
    schedulesAt: Date
    flowId: string | null
    contactFilter?: unknown
  }): MasterAgentReminderView {
    // The DB columns are text pinned by these enums at write time; the row
    // type widens them to `string`.
    const status = row.status as BroadcastStatus
    const schedulesType = row.schedulesType as BroadcastScheduleType
    return {
      id: row.id,
      name: row.name,
      status,
      schedulesType,
      schedulesAt: row.schedulesAt,
      flowId: row.flowId,
      contactIds: readAudienceContactIds(
        row.contactFilter as ContactFilterCriteriaInput | null,
      ),
    }
  }
}

export const masterAgentService = new MasterAgentService()
export { MasterAgentService }

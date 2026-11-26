# Master Agent (reminder drafting)

An in-product assistant that turns a pasted Zoom summary into a **draft** reminder
broadcast for a course group. It never schedules and never sends: a member with
`broadcasts` + `flows` reviews the draft and confirms it in the UI
(`POST /v1/broadcasts/{id}/schedule`).

## Flow

1. `POST /v1/master-agent/messages` (or the builder chat) calls
   `masterAgentService.sendMessage`, which stores the member's turn plus a
   `pending` assistant row in `MasterAgentMessage` and enqueues
   `processMasterAgent` on the existing `aiAgent` queue.
2. The worker consumer runs the workspace's **non-default** agent
   (`AIAgent.isDefault = false`, oldest first) with the session history up to
   this turn as the prompt and only the six reminder tools. History stops at
   the turn's own row, so a follow-up queued behind it is never answered twice.
   The turn is operator-initiated, so the integration's "AI Auto Reply" switch
   does not gate it (enablement still must be on). The reply is written back into the
   pending row (`completed`, or `failed` with empty content).
3. `GET /v1/master-agent/sessions/{sessionId}` returns the session: messages,
   the latest turn's status, and the reminder drafts linked to it.

There is no second code path: the public API, the builder's private API and the
worker all call `masterAgentService` (`packages/business/src/master-agent`).

## Tools

| Tool | Effect |
|---|---|
| `listGroups` | Group contacts discovered by `ContactInbox.sourceId LIKE 'group:%'` — a new K group needs no code change. |
| `listFlows` | The workspace's published, active flows (`id`, `name`) — the agent picks the reminder's flow by name instead of hard-coding an id (PO item 28 `e656`). |
| `listReminders` | Reminder broadcasts (`draft` / `scheduled` / `recurring` / `cancelled`). |
| `draftReminder` | Creates the broadcast as `draft` for one group contact, `schedulesType: "future"`, `saveAsDraft: true`. The `flowId` must exist in the workspace (`flowService.exists`), otherwise the tool errors before any draft is written. |
| `updateReminderDraft` | Edits group / flow / name / send time of a **draft** only; a new `flowId` is re-checked against the workspace. |
| `stopReminder` | Scheduled → back to `draft`; sending or recurring → stopped. |

One turn drafts at most one reminder: the turn row carries a single
`broadcastId`, so a second `draftReminder` in the same turn is refused with a
message telling the model to edit the draft it already created. `listReminders`
includes `sending`, so `stopReminder` can be aimed at a broadcast already in
flight.

The toolset is **six** tools: the three read-only lookups above plus the three
reminder actions. The original spec said "exactly five"; PO added `listFlows`
(item 28, `e656`), so the allowlist is six — the safety constraint is unchanged:
no `schedule`, no `sendNow`, no `delete`.

The tools run in-process against the workspace (`getMasterAgentTools` in
`packages/ai/src/server/tools/master-agent.ts`); the agent never holds a
workspace token and never calls HTTP/MCP.

They are imported from their own subpath, `@inboxos.io/ai/master-agent-tools`,
and are **not** re-exported by the shared `@inboxos.io/ai/server` tools barrel:
that barrel is loaded by every AI consumer (and by test mocks of it), and the
reminder tools pull the business/database graph with them.

## Audience and time

- A reminder's audience is pinned with a `field: "contactId"` filter condition
  plus `lastInteraction` (either state), because a group contact has no DM and
  the default DM requirement would drop it. `contactId` is a first-class
  member of the contact-filter field enum and a schema branch in the builder's
  filter, but it is never offered in the condition picker: a filter the UI
  cannot parse is replaced by an empty one on the next save (and dropped by
  resend), which would widen the audience to every contact with a direct chat.
- Times are read as `Asia/Saigon` wall-clock: `YYYY-MM-DD HH:mm` is parsed as
  `+07:00`, never as server-local time. Vietnam has no DST.
- The draft's channel is `omnichannel` (`allContacts`), which resolves every
  inbox of the workspace; a broadcast sends a **flow**, so `flowId` is required
  (the agent picks it from `listFlows`) and the reminder's message text lives in
  that flow.

## Isolation

- The agent must be `isDefault = false`; nothing here touches the default agent,
  the Global Router, `groupReplyConfig`, or any channel webhook, so a customer DM
  can never reach it.
- `workspaceId` always comes from the caller's token/session, never from input;
  a session id of another workspace is a 404.

## Public surface

| Surface | Name |
|---|---|
| oRPC | `masterAgent.sendMessage` (`POST /v1/master-agent/messages`), `masterAgent.getSession` (`GET /v1/master-agent/sessions/{sessionId}`) — scope `broadcasts` |
| Builder UI | `/space/{workspaceId}/master-agent` chat page (route `app/space/[workspaceId]/master-agent/page.tsx`), private router `masterAgentAPIs` |
| CLI | `inboxos master-agent send-message`, `inboxos master-agent get-session` |
| MCP | `master_agent_send_message`, `master_agent_get_session` (default visibility) |

## UI (builder)

A member needs both the `broadcasts` section (`broadcast` permission flag) and
`flows`; the service itself checks no member permissions, so every entry point
gates: the page (`requireMasterAgentPageAccess`), and the three private
procedures (`masterAgentForbidden`, 403). A non-member gets the repo-wide 404
from the page and 401 from `workspaceAuthorizedMidddleware` on the API.

| Private procedure | method + path |
|---|---|
| `sendMasterAgentMessageAPI` | `POST /workspaces/{workspaceId}/master-agent/messages` |
| `getMasterAgentSessionAPI` | `GET /workspaces/{workspaceId}/master-agent/sessions/{sessionId}` |
| `confirmMasterAgentDraftAPI` | `POST /workspaces/{workspaceId}/master-agent/drafts/{broadcastId}/confirm` |

`sendMessage` passes `memberId: context.user.id`; `confirmDraft` is the only
draft → scheduled path in the UI and takes no schedule data: it reads the draft
through `masterAgentService.getReminder` (workspace-scoped, 404 otherwise),
refuses anything not `draft`, then calls `broadcastService.scheduleDraft` with
the draft's own `schedulesType`/`schedulesAt`. Both session procedures add the
draft's `group` (`{contactId, name, sourceId}`) from `masterAgentService.listGroups`
so the card names the `group:` contact; the chat formats the send time in
`Asia/Saigon`.

## Tests

- `packages/business/src/master-agent/__tests__/service.test.ts` — workspace
  scoping, draft-only creation, timezone parsing, and a `flowId` outside the
  workspace refused before a draft is written.
- `packages/ai/__tests__/master-agent-tools.test.ts` — exactly six tools
  (`listFlows` included), no schedule/send/delete.
- `apps/worker/__tests__/master-agent.test.ts` — consumer writes the reply and
  a tool call reaches the service (LLM mocked).
- `apps/builder/__tests__/master-agent-public-api.test.ts` — 401/403, input
  validation, token-workspace isolation.
- `apps/builder/__tests__/master-agent-private-api.test.ts` — 401/403 for the
  private procedures, `memberId` attribution, confirm schedules only a `draft`
  of the same workspace with its own stored schedule.
- `apps/builder/__tests__/master-agent-page-access.test.ts` — page gate: 404 for
  a non-member, 403 without `broadcasts` or without `flows`.
- `apps/builder/__tests__/master-agent-draft-card.test.tsx` — the card shows the
  group and the `Asia/Saigon` time; Confirm is absent without the permissions,
  disabled while the request runs, and gone once the draft is scheduled.

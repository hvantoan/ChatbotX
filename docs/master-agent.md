# Master Agent (workspace operator assistant)

An in-product assistant that operates the workspace **through the public API**:
contacts, flows, broadcasts, AI agents, inbox, pipelines — everything the
catalog exposes. It never bypasses the API: every write the agent proposes
goes through the same endpoints, the same permissions and the same validation
an operator with a workspace token would face.

## Architecture

```text
member / workspace-token caller
  → POST /v1/master-agent/messages  (or the builder chat)
  → masterAgentService.sendMessage  (packages/business/src/master-agent)
      stores user turn + pending assistant row in MasterAgentMessage
      enqueues processMasterAgent on the aiAgent queue
  → worker consumer (apps/worker/src/ai-agent/handlers/process-master-agent.ts)
      loads the session, the MasterAgentConfig and the API catalog
      mints a 5-minute internal credential for the turn
      runs generateText with the three meta-tools
  → meta-tools (apps/worker/src/lib/master-agent/run.ts)
      search_tools / call_tool / get_guide
      call_tool enforces hitlPolicy server-side before any HTTP call
  → HTTP to the workspace's own public API
```

### Configuration — not an AIAgent row

The Master Agent is **not** a record in `AIAgent`. Its configuration lives in
`MasterAgentConfig` (one row per workspace): `models` (the
`AIAgentProviderModels` shape, picking from the workspace's connected AI
integrations), an extra `prompt` appended after the built-in system prompt,
`enabled`, and `autoApproveDiff`. Read/write via `masterAgent.getConfig` /
`masterAgent.updateConfig` — public procedures like everything else
(invariant 23). The UI page (`/space/{workspaceId}/master-agent`) exposes the
same form; writing it requires the `flows` permission.

### The catalog is the toolset

The agent is never handed hundreds of tools. It gets three meta-tools, exactly
like the MCP server:

- `search_tools` — full-text search over the catalog (rank + multilingual
  normalization live in the shared `packages/openapi-catalog` package).
- `call_tool` — executes one operation by name.
- `get_guide` — returns the operational guide of a resource group
  (`inbox-and-handover`, `contacts-and-pipelines`, `flows-and-automation`) so
  the agent reads the procedure before its first mutation there.

The catalog itself is generated from `GET /api/public-spec.json`, parsed and
cached by `packages/openapi-catalog` (`createSpecLoader`) — the same package
the MCP server and the CLI now consume; there is exactly one implementation of
spec parsing, search ranking and tool execution. Operations under the
`masterAgent.*` prefix are excluded from the worker's catalog so the agent
cannot recursively start new turns of itself.

### The internal credential

The worker never holds a real `WorkspaceApiToken`. For each turn it mints a
short-lived credential (`mintMasterAgentCredential` in
`packages/business/src/master-agent/internal-credential.ts`): an HMAC-signed
token valid for five minutes carrying `workspaceId`, `sessionId`, the turn's
identity — `memberId` for a member-driven chat, `tokenId` when the message
arrived over a workspace token — and `purpose: "master-agent"`. It is signed
with the same `BETTER_AUTH_SECRET` the builder verifies it with; the worker
reads the secret from its own env (optional there — a turn without it fails
with a clear message instead of a confusing 401 loop).

`workspaceTokenAuthMidddleware` (three d's, invariant 1) recognizes the
credential in `apps/builder/src/lib/master-agent/resolve-master-agent-principal.ts`:

- a **member** turn resolves through `resolveWorkspaceAccess` (invariant 19,
  so support sessions work) and the member's permissions are derived into the
  same scope list a workspace token would carry — a member without `contacts`
  can't read contacts even through the agent. A non-superAdmin member
  credential additionally shares the mobile **reviewed-route allowlist**
  (`MOBILE_MEMBER_ROUTES` in `apps/builder/src/lib/mobile-auth/member-route-allowlist.ts`):
  the public router's hundreds of operations are written for workspace-level
  tokens, and only the reviewed ones apply member scoping (assigned contacts,
  PII masking) in their handler, so everything else is a hard 403 — the model
  sees the error as an ordinary tool result. A `superAdmin` member is exempt:
  their derived scopes are the unrestricted token, the same privilege their
  own UI session already has;
- a **token** turn acts with exactly the scopes of the originating token;
- a credential for another workspace, an expired credential, or a tampered
  payload is rejected before any service call.

The crypto lives behind the subpath `@inboxos.io/business/master-agent/internal-credential`
so node:crypto never enters the builder's Edge router graph (invariant 25).

## Human-in-the-loop confirmation

The server enforces the confirmation policy of every operation — taken from
its `x-mcp.hitlPolicy` in the spec — never the model:

| Policy | Behavior |
|---|---|
| `none` | Executes immediately. |
| `confirm_diff` | Executes immediately when `autoApproveDiff` is on; otherwise waits for approval. |
| `confirm_outbound` / `confirm_destructive` | **Always** waits for approval. |

"Waits for approval" means `call_tool` writes a `MasterAgentPendingAction`
row — operationId, args, policy, a snapshot of the resource's current state,
and the **frozen execution shape** (method, path template, param names, body
param names) — and returns a pending-approval notice to the model *without*
calling the API. The model's own `_confirm` argument is ignored entirely:
confirmation is a human decision made in the UI, and the MCP-style client-side
hitl gate is deliberately not replicated in the worker.

The chat renders each pending action as a card with the proposed args and the
current state, a Confirm/Reject pair, and an edit link to the resource
(`/<resource>/<id>` derived from the path template when it names exactly one
well-known id). Confirming replays the frozen execution verbatim — with a
credential minted for the **reviewer**, so the executed call carries the
reviewer's permissions — and the conditional `UPDATE ... WHERE status =
'pending'` is the single-winner guard: two simultaneous confirms can never run
the call twice, and a confirm racing an expiry loses cleanly. An approved call
that the API rejects settles as `failed`, terminal by design.

Pending actions expire lazily: rows older than 24 hours flip to `expired` the
next time anyone reads or writes the workspace's actions, and a new turn in
the same session supersedes the session's unanswered actions immediately.
There is deliberately no cleanup job.

### Session visibility

A session started by a member belongs to that member: another member reading
it would see API results fetched with the initiator's scopes (contact details,
message bodies) that their own permission flags may mask. The service enforces
this on both the send and the read path — a foreign session id is a 404, the
same as an unknown one. A superAdmin may review any session, and a
token-started session has no member to bind to, so it stays workspace-level
(every caller is still bounded by the token's scopes). The worker reads with
`asSystem: true`: the job it runs is exactly the turn it was handed. The
decision paths are bound the same way: a pending action inherits its session's
visibility, so only the member who owns the session (or a superAdmin) may
confirm or reject it — knowing another member's action id is not enough.

### Caller identity

- **Member (UI / mobile JWT)** — the turn and the confirm act with the
  member's own permissions.
- **Workspace API token** — the turn carries the real token id; a token
  revoked mid-session makes the next call a 401.
- **MCP OAuth** — the middleware folds the user into the synthetic id
  `oauth:<clientId>:<userId>`; the API extracts that user id so the turn acts
  as that member instead of minting a credential no token row can resolve.
- **Config writes** (`updateConfig`) require the `flows` permission for member
  callers — the prompt steers every member's turns and `autoApproveDiff`
  switches review off workspace-wide.

## Public API surface

| Operation | Notes |
|---|---|
| `masterAgent.sendMessage` | Runs one turn. Scope: `automation`. Returns the session as it now stands (assistant row `pending`). |
| `masterAgent.getSession` | Messages + pending actions of one session, workspace-scoped. |
| `masterAgent.getConfig` / `masterAgent.updateConfig` | The configuration row. |
| `masterAgent.confirmPendingAction` / `masterAgent.rejectPendingAction` | The review decision. Confirm executes server-side with the caller's identity. |

Private counterparts power the chat page under the same service methods.

## Data model

- `MasterAgentMessage` — session history (workspace, sessionId, role, content,
  status, createdById).
- `MasterAgentConfig` — one row per workspace.
- `MasterAgentPendingAction` — approval queue (status `pending`/`approved`/
  `rejected`/`expired`/`failed`, frozen execution, result, decidedById,
  expiresAt).

All three ship in **one** squashed migration (`*_master_agent`).

### Full turn history (trace): required, not implemented yet

Product decision of 2026-11-27 (Jira CB-4, CB-12, CB-15): every turn, failed
ones included, must keep a **complete, replayable** history so the harness
(prompt, tools, guards) can be analysed and improved. This replaces the
earlier rule of storing only the turn text.

- What a trace holds: the turn's full messages as JSON (text, tool calls,
  arguments, results or errors), the codemode script and its inner calls if
  any, model and provider, system prompt version, tokens, cost, step count,
  duration and errors. The approval lifecycle stays in
  `MasterAgentPendingAction`.
- Credentials and secrets (the internal credential, API keys, `Authorization`
  headers) never reach a trace.
- Large tool results need a size cap and a defined overflow (truncate with a
  marker, or object storage).
- Trace rows carry `workspaceId` and are purged with the workspace
  (invariant 24).
- Open: retention period, whether traces from one workspace may improve the
  harness for all workspaces (they contain customer data, so this needs terms
  or consent and possibly anonymisation), and who may read them.

## System prompt

The built-in prompt pins the timezone (`Asia/Saigon`, 24h `dd/MM/yyyy HH:mm`),
tells the agent to read the operational guide of a resource group before its
first mutation, to resolve ids with list/search operations instead of
guessing, to stop retrying an action once it is pending approval, and forbids
the `_confirm` argument outright. The workspace's extra `prompt` is appended.

## Tests

- `packages/business/src/master-agent/__tests__/service.test.ts` — send/config/
  pending-action lifecycle, single-winner claim shape.
- `packages/business/src/master-agent/__tests__/internal-credential.test.ts` —
  mint/verify round trip, expiry, tampering, wrong secret, wrong purpose.
- `apps/worker/__tests__/master-agent.test.ts` — the consumer loop, hitl
  enforcement (outbound/destructive never reach HTTP unapproved,
  `confirm_diff` honors `autoApproveDiff`), `_confirm` stripping.
- `apps/builder/__tests__/master-agent-principal.test.ts` — credential
  resolution: cross-workspace forbidden, revoked token 401, permission-derived
  scopes.
- `apps/builder/__tests__/master-agent-confirm-execution.test.ts` — replay
  uses the frozen shape with the reviewer's credential; a lost claim race is
  a conflict and never executes.
- `apps/builder/__tests__/master-agent-public-api.test.ts` /
  `master-agent-private-api.test.ts` — 401/403, scope gating, config admin
  permission.
- `apps/builder/__tests__/master-agent-pending-action-card.test.tsx` — the
  card's decision UI and edit link.

---
title: Zalo Personal group history backfill
date: 2026-11-22
summary: Manual getCloudMessage backfill (200/group) in gateway; personal live-only
---

# Zalo Personal group history backfill

## Context
Zalo Personal chats showed almost no group history: the gateway only ingested the `old_messages` push Zalo sends on connect. Personal 1-1 history has no zca-js API, so it stays live-only.

## Decisions
- Dropped contact-directory sync (empty `contactHandlers`, message-centric webhook schema, and contacts without conversations do not appear in Inbox).
- Group backfill via `getCloudMessage`, capped at 200 messages/group, sequential with 400ms page delay.
- Manual only (`POST /accounts/:uid/sync`); connect keeps the server-pushed `old_messages` only.
- Background run; HTTP returns `{ok:true}` immediately. Dedupe relies on `Message.sourceId` upsert.

## Changes
- `apps/zalo-personal-gateway/src/session-manager.ts`: added `backfillGroupHistory`/`backfillOneGroup`, split `requestOldMessages` for connect, removed sync-flag ownership from `handleOldMessages`.
- `apps/zalo-personal-gateway/__tests__/session-backfill.test.ts`: pagination, payload shape, 200-message cap.

## Verification
- `pnpm --filter zalo-personal-gateway check-types` clean.
- `pnpm --filter zalo-personal-gateway test`: 13 passed.
- Live Sync over 52 groups: returned in 11ms; backfill logged per-group stop reasons; the single returned message was already in the DB and was deduped (row count unchanged).

## Limitation
Zalo cloud message storage returned empty/filtered for 51 of 52 groups for this account; only the active group yielded one message. The mechanism is correct but the data source is sparse.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

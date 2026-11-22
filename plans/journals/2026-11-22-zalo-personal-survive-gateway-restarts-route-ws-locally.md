---
title: "Zalo Personal: survive gateway restarts, route /ws locally"
date: 2026-11-22
summary: "Defer zalo_personal sends on 409, dedupe concurrent gateway logins, add caddy /ws ingress, fix healthchecks"
---

# Zalo Personal: survive gateway restarts, route /ws locally

## What happened

- `/ws` never reached realtime in prod because the NPM Proxy Host had no `/ws/` location; the builder only rewrites it under `next dev`.
- A gateway restart dropped every in-memory Zalo session. Inbox sends then failed with 409 `session_not_connected`, because the chat worker recorded the failure before the restore cron (60s) could log the account back in.
- Two `/accounts/start` calls for one account (restore cron + user reconnect) stopped the session mid-login and started a second login, which kicked the first out of Zalo.
- Builder and gateway containers reported `unhealthy`: the builder release image has no `curl`, and the Next standalone server binds the container hostname, not `localhost`.

## Decision

- Local dev now mirrors prod: a `caddy` service publishes `3123`, strips `/ws` and proxies to `realtime:1999`, everything else to `builder:3000`. The builder no longer publishes 3123.
- Healthchecks use `node -e "fetch('http://'+process.env.HOSTNAME+':<port>/<path>')"` for builder (hostname bind) and gateway.
- `ensureZaloPersonalSession` is the single restore path, shared by the cron and the send path.
- `sendMessageToChannel` accepts an optional `deferOnError` hook, invoked at the top of the catch before anything is recorded. The zalo gate restores the session fire-and-forget and parks the job with `moveToDelayed` + `DelayedError` (5s/10s/20s/40s, max 4). A session in `error` or an exhausted budget fails normally.
- Flow/bot sends (`sendFlowMessage`, `sendChatMessage`) stay out of scope: their runner awaits each step.

## Verified

- `pnpm --filter worker check-types`, `pnpm --filter zalo-personal-gateway check-types`, `pnpm --filter @chatbotx.io/integration-zalo-personal check-types`.
- `pnpm lint` (11,443 files), `pnpm check:invariants`.
- Worker targeted suites (75 tests) and gateway suites (18 tests).
- Local stack: `http://localhost:3123/api/health` → 200; WS upgrade `/ws/rt/workspaces/1` → 401 via caddy and direct realtime; builder and gateway report healthy.

## Next steps

- Prod: paste the `/ws/` location into the `chatbot.viethaviral.com` Proxy Host in NPM (returns 401 on upgrade) and merge the `host-config` working-tree changes (healthchecks + AGENTS.md note).
- Rebuild/redeploy the worker image so the 409 deferral runs in prod.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

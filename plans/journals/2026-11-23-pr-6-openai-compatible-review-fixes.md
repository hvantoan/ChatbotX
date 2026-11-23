---
title: PR 6 OpenAI-Compatible Review Fixes
date: 2026-11-23
summary: "Skip endpoint probe on unchanged baseURL edits, keep connect fail-fast on unreachable, add self-hosted upgrade note, duplicate-URL i18n, and GET schema check."
---

# PR 6 OpenAI-Compatible Review Fixes

## What happened

Addressed PR #6 (`e7af12797`) review findings in `feat/cb-1-openai-compatible-api-ssrf` worktree:

1. **Edit dialog probe regression (`packages/business/src/integration-openai-compatible/service.ts`):** `updateWithVerification` previously probed `/models` whenever `rawBaseURL !== undefined` (which the edit dialog always sends prefilled), causing renames/model changes to fail with `invalidBaseUrl` when a local server was stopped or lacked `/models`. Now `verifyOpenaiCompatibleProvider` runs only when a new `apiKey` is sent or normalized `baseURL` changed, while `validateOpenaiCompatibleBaseUrlForEnvironment` still runs on every `baseURL` update.
2. **Connect action unreachable check (`apps/builder/src/features/integration-openai-compatible/actions/connect.action.ts`):** Confirmed keeping `unreachable` mapped to the `baseURL` validation error because `connectFromCredentials` already calls `verifyOpenaiCompatibleEndpoint` (which rejects 404/network/timeout on `main`).
3. **Self-hosted upgrade note (`docs/openai-compatible.md`):** Documented breaking behavior for existing `127.0.0.1`/LAN configs without `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS=true`.
4. **Duplicate URL i18n (`apps/builder/src/features/integration-openai-compatible/actions/update.action.ts`, `apps/builder/messages/*.json`):** Added `openaiCompatible.validation.baseUrlAlreadyConnected` across all 21 locale files.
5. **Nits:** Rejected `integrationId` for legacy providers in `getAiProviderRequest`, updated stale comment in `packages/business/src/ai-mcp-server/endpoint-policy.ts`, and reconciled `plans/261122-1828-cb-1-openai-compatible-api-ssrf/plan.md` statuses/checkboxes.

## Verification

- Targeted Vitest suites in `@chatbotx.io/business` (5 files, 60 tests), `builder` (8 files, 126 tests), and `chatbotx` CLI (5 files, 60 tests) passed.
- `pnpm lint` (agent instructions, invariants, turbo lint, `i18n:check`, ultracite) and `pnpm check-types` (69/69 packages) passed.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

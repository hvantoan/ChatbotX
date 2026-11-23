---
title: "CB-1 PR 1: OpenAI-Compatible Public API, SSRF Default-On & Docs"
description: "Unblock end-to-end agent flow for OpenAI-compatible providers via integrations.getAiProvider/updateAiProvider, fix ai_agents_create integrationId description, enable SSRF guard by default with self-host opt-out env, and sync manifest/CLI/MCP docs."
status: completed
priority: P1
effort: "1-2d"
tags: [cb-1, openai-compatible, public-api, ssrf, mcp, cli]
created: 2026-11-22
---

# CB-1 PR 1: OpenAI-Compatible Public API, SSRF Default-On & Docs

## Overview

PR 1 of CB-1 unblocks the end-to-end AI agent workflow for OpenAI-compatible models using existing `connections.*` (connect/disconnect) plus extended `integrations.getAiProvider` / `integrations.updateAiProvider`, fixes the misleading `integrationId` description in `aiAgents.create`, enables the SSRF guard by default on self-hosted deployments with an explicit env opt-out (`OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS`, ignored when `isCloud()`), and updates the API parity manifest, OpenAPI spec tests, and CLI/MCP docs.

PR 2 (encryption at rest across all 7 AI provider tables + extra readers/writers + backfill script) will follow in a separate PR after PR 1 lands.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Enable SSRF guard by default for `openaiCompatible` with self-host env opt-out (`OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS`), ignored on cloud | P1 |
| 2 | Share a single service update+verification path between UI actions (`updateOpenaiCompatibleAction`) and public API (`integrations.updateAiProvider`) | P1 |
| 3 | Extend `integrations.getAiProvider` and `integrations.updateAiProvider` to support `openaiCompatible` and fix `aiAgents.create` `integrationId` description | P1 |
| 4 | Flip `integration-openai-compatible/*` manifest entries to `covered:*`, pass spec/MCP/CLI tests, and document env opt-out + disconnect risk | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: SSRF Default-On & Shared Service](./phase-01-start.md) | Completed |
| 2 | [Phase 2: Public API & Agent Description](./phase-02-public-api-and-agent-description.md) | Completed |
| 3 | [Phase 3: Manifest, Snapshots & Docs](./phase-03-manifest-snapshots-and-docs.md) | Completed |

## Success Criteria

- [x] `aiProviderPathParam` includes `openaiCompatible`; `GET /v1/integrations/ai/openaiCompatible` returns `{ data: [...] }` with satellite `id`, `integrationId`, `name`, `preset`, `baseURL`, `defaultModel`, `enabled`, `autoReply`, `hasApiKey` (never `auth`/`apiKey`/`workspaceId`), filtered when `integrationId` query param is given
- [x] `PATCH /v1/integrations/ai/openaiCompatible` requires `integrationId`, updates `autoReply`, `enabled`, `name`, `preset`, `defaultModel`, `baseURL` (re-running SSRF), `apiKey`, and calls the same service method as UI `updateOpenaiCompatibleAction`
- [x] `aiAgents.create` `models[].integrationId` description points to `integrations.getAiProvider` (`provider: "openaiCompatible"`) satellite `id`
- [x] `127.0.0.1` baseURL returns 400 `ssrfBlocked` by default on both cloud and self-hosted; `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS=true` allows it only when `!isCloud()`; `.env.example` documents the env var
- [x] `api-parity-manifest.json` has zero `private:` entries for `integration-openai-compatible/*`
- [x] `pnpm lint`, `pnpm check-types`, and targeted builder/business/cli tests pass

## Red Team Review

- **Reviewers:** Security Adversary + Assumption Destroyer (`692847ff`) and Failure Mode Analyst (`b083eb0e`)
- **Accepted & Propagated Fixes:**
  1. Set `redirect: "manual"` and reject 3xx responses in `verifyOpenaiCompatibleProvider` (`phase-01-start.md`).
  2. Prevent stored `apiKey` exfiltration across origins: require `apiKey` when changing `baseURL` to a different origin (`phase-01-start.md`).
  3. Always run SSRF check on `baseURL` updates (even if normalized string matches `existing.baseURL`) and check `if (!existing)` before verifying (`phase-01-start.md`).
  4. Ignore blank `apiKey` in `service.ts` and enforce `.trim().min(1)` in public PATCH schema (`phase-01-start.md`, `phase-02-public-api-and-agent-description.md`).
  5. Keep `legacyAiProviderPathParam` (5 providers) for `PUT`/`DELETE` routes so `connectAiProvider`/`disconnectAiProvider` stay untouched (`phase-02-public-api-and-agent-description.md`).
  6. Keep `updateAiProviderRequest` as a flat `z.object(...).superRefine(...)` with `integrationId` `.optional()` in the static Zod shape (satisfies `TRAILING_PATH_PARAM_PATTERN` zero-required-body-field rule and CLI `openapi-loader.ts` flat properties parser) (`phase-02-public-api-and-agent-description.md`).
  7. Declare `ssrfBlocked`, `invalidBaseUrl`, `connectionCredentialsRejected`, and `presetAlreadyConnected` in `orpc-error-helper.ts` (`possibleErrorsOnUpdatingAiProvider`) and convert `OpenaiCompatiblePresetAlreadyConnectedError` / not-found errors to `ChatbotXException` / `notFoundException` (`phase-01-start.md`, `phase-02-public-api-and-agent-description.md`).
  8. Resolve both satellite `id` and parent `integrationId` when filtering/updating `openaiCompatible`, while keeping canonical satellite `id` in `id` and documenting `id` vs `integrationId` clearly (`phase-02-public-api-and-agent-description.md`).
  9. Sync `Connection.sourceId`/`displayName` when `baseURL`/`name` changes in `service.update`, and pass an optional `resolveDefaultModel` callback when `preset` changes without `defaultModel` (`phase-01-start.md`, `phase-02-public-api-and-agent-description.md`).
  10. Update test mocks in `credential-providers.test.ts`, `openai-compatible-provider-verify.test.ts`, `openai-compatible-actions.test.ts`, and `integrations-public-api.test.ts` (`phase-01-start.md`, `phase-02-public-api-and-agent-description.md`).
  11. Fix doc reference from `connections.delete` to `connections.disconnect` (`phase-03-manifest-snapshots-and-docs.md`).
- **Out-of-Scope / Deferred Notes:**
  - Global `ssrf-guard.ts` `AAAA` resolution and runtime `createOpenaiCompatibleModelInstance` async SSRF check are outside PR 1's `openaiCompatible` API+SSRF scope (`packages/ai` stays untouched until PR 2).
- **Whole-Plan Consistency Sweep:** Verified phase links, error codes, schema shapes, and package dependency direction (`@chatbotx.io/business` does not import `@chatbotx.io/ai`).

<!-- slug: cb-1-openai-compatible-api-ssrf -->

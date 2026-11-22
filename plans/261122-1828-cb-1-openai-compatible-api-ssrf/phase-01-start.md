---
title: "Phase 1: SSRF Default-On & Shared Service"
status: todo
---

# Phase 1: SSRF Default-On & Shared Service

## Overview

Enable SSRF protection by default for OpenAI-compatible base URLs across all editions, add the self-host-only `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS` env opt-out (ignored when `isCloud()`), and consolidate verification + update into a shared `integrationOpenaiCompatibleService` method used by both the UI action and the upcoming public API handler.

## Requirements

- [x] `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS` (`z.stringbool().default(false)`) added to `packages/business/src/keys.ts` (`allowPrivateOpenaiCompatibleUrls()`) and documented in `.env.example`
- [x] `validateOpenaiCompatibleBaseUrlForEnvironment` runs `assertPublicUrl` by default; skips only when `!isCloud() && allowPrivateOpenaiCompatibleUrls()`; rejects embedded `user:pass@` URL credentials in `normalizeOpenaiCompatibleBaseUrl`
- [x] `verifyOpenaiCompatibleProvider` moved to `packages/business/src/integration-openai-compatible/verify.ts` with `redirect: "manual"` (rejecting 3xx responses) and `apps/builder/src/features/integration-openai-compatible/lib/index.ts` re-exporting it
- [x] `integrationOpenaiCompatibleService.updateWithVerification` checks `existing` first (`notFoundException` 404), blocks cross-origin `baseURL` changes without a new `apiKey`, re-validates SSRF on effective `baseURL`, verifies credentials, ignores blank `apiKey`, resolves `defaultModel` via optional callback when `preset` changes without `defaultModel`, keeps `Connection.sourceId`/`displayName` in sync, and uses `ChatbotXException` for `OpenaiCompatiblePresetAlreadyConnectedError` (409 `presetAlreadyConnected`)

## Implementation Steps (TDD)

1. Write failing unit tests first:
   - `packages/business/__tests__/integration-openai-compatible-base-url.test.ts`: cover `cloud` (blocks private URLs even when opt-out env is true), `self-hosted` default (blocks `127.0.0.1` with `ssrfBlocked`), `self-hosted` with opt-out env `true` (allows `127.0.0.1`), and rejection of URLs with embedded credentials.
   - `packages/business/src/connection/__tests__/credential-providers.test.ts`: update `../../keys` mock (`allowPrivateOpenaiCompatibleUrls`), verify `127.0.0.1` is blocked when `!isCloud()` and opt-out env is false, and allowed when `!isCloud()` and opt-out env is true.
   - `packages/business/__tests__/integration-openai-compatible-service.test.ts`: cover `updateWithVerification` (404 before verify, cross-origin `baseURL` without `apiKey` rejected, SSRF failure before HTTP verify, unauthorized 401/403 rejection, preset conflict, blank `apiKey` ignored, `preset` change `resolveDefaultModel` callback, and `Connection` sync).
2. Implement `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS` + `allowPrivateOpenaiCompatibleUrls()` in `packages/business/src/keys.ts` and document in `.env.example`.
3. Update `packages/business/src/integration-openai-compatible/validate-base-url.ts`.
4. Add `packages/business/src/integration-openai-compatible/verify.ts` (with `redirect: "manual"`) and export from `packages/business/src/integration-openai-compatible/index.ts`. Update `apps/builder/src/features/integration-openai-compatible/lib/index.ts` and `apps/builder/__tests__/openai-compatible-provider-verify.test.ts`.
5. Implement `updateWithVerification` and hardened `update` in `packages/business/src/integration-openai-compatible/service.ts` (using `notFoundException` and `ChatbotXException` for `OpenaiCompatiblePresetAlreadyConnectedError`).
6. Refactor `apps/builder/src/features/integration-openai-compatible/actions/update.action.ts` (`updateOpenaiCompatibleAction` and `updateOpenaiCompatibleEnabledAction`) to call `integrationOpenaiCompatibleService.updateWithVerification`, updating `apps/builder/__tests__/openai-compatible-actions.test.ts`.

## Verification

- `pnpm --filter @chatbotx.io/business test -- integration-openai-compatible`
- `pnpm --filter @chatbotx.io/business test -- credential-providers.test.ts`
- `pnpm --filter builder test -- openai-compatible-actions.test.ts openai-compatible-provider-verify.test.ts`

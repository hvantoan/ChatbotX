---
title: "Phase 2: Public API & Agent Description"
status: completed
---

# Phase 2: Public API & Agent Description

## Overview

Extend `integrations.getAiProvider` and `integrations.updateAiProvider` to support `openaiCompatible` using the shared business service methods, and fix the `aiAgents.create` `integrationId` description so agents resolve the satellite `id` from `integrations.getAiProvider`.

## Requirements

- [x] `aiProviderPathParam` includes `"openaiCompatible"`; `legacyAiProviderPathParam` keeps the 5 legacy providers for `connectAiProvider` (PUT) and `disconnectAiProvider` (DELETE)
- [x] `GET /v1/integrations/ai/openaiCompatible` accepts optional `integrationId` query param (matching satellite `id` or parent `integrationId`) and returns `{ data: [...] }` containing satellite `id`, `integrationId`, `name`, `preset`, `baseURL`, `defaultModel`, `enabled`, `autoReply`, `hasApiKey` (never `auth`, `apiKey`, or `workspaceId`)
- [x] `PATCH /v1/integrations/ai/openaiCompatible` keeps a flat `z.object(...).superRefine(...)` request schema (with `integrationId` `.optional()` statically and enforced in `superRefine`, `.describe(...)` on every field, `apiKey: z.string().trim().min(1).optional()`, `preset: openaiCompatibleProviderPresets.optional()`), calls `integrationOpenaiCompatibleService.updateWithVerification`, and returns the updated satellite resource (never `auth`, `apiKey`, or `workspaceId`)
- [x] `apps/builder/src/lib/orpc/orpc-error-helper.ts` defines `possibleErrorsOnUpdatingAiProvider` declaring `ssrfBlocked` (400), `invalidBaseUrl` (400), `connectionCredentialsRejected` (400), and `presetAlreadyConnected` (409)
- [x] `apps/builder/src/features/ai-agents/schema/action.ts` `models[].integrationId` description instructs agents to get the satellite `id` from `integrations.getAiProvider` (`provider: "openaiCompatible"`, field `id`)

## Implementation Steps (TDD)

1. Write failing unit tests first:
   - `apps/builder/__tests__/integrations-public-api.test.ts`:
     - Update `@chatbotx.io/ai` and `@chatbotx.io/business` mocks (`openaiCompatibleProviderPresets`, `integrationOpenaiCompatibleService`).
     - `GET /v1/integrations/ai/openaiCompatible`: list returns `{ data: [...] }` with all required fields and no `auth`/`apiKey`/`workspaceId`; filtering by `integrationId` returns `{ data: [item] }` or throws 404 when missing.
     - `PATCH /v1/integrations/ai/openaiCompatible`: rejects missing `integrationId`, delegates to `integrationOpenaiCompatibleService.updateWithVerification`, propagates SSRF/invalidBaseUrl/connectionCredentialsRejected/presetAlreadyConnected, returns updated satellite resource without secrets.
   - `apps/builder/__tests__/ai-agent-action-schema.test.ts`: assert `createAIAgentRequest` `openaiCompatible.integrationId` description references `integrations.getAiProvider` and not `integrations.list`.
2. Update `apps/builder/src/lib/orpc/orpc-error-helper.ts` with `possibleErrorsOnUpdatingAiProvider`.
3. Update `apps/builder/src/features/integrations/schema/ai-provider.ts` with `legacyAiProviderPathParam`, `aiProviderPathParam` (including `openaiCompatible`), flat `updateAiProviderRequest` + `.superRefine(...)`, and response schemas (`getAiProviderResponse`, `updateAiProviderResponse`).
4. Update `apps/builder/src/features/integrations/api/public/ai.ts` (`getAiProvider` and `updateAiProvider` handlers + route descriptions; keep `connectAiProvider` and `disconnectAiProvider` on `legacyAiProviderPathParam`).
5. Update `apps/builder/src/features/ai-agents/schema/action.ts` `integrationId` `.describe(...)`.

## Verification

- `pnpm --filter builder test -- integrations-public-api.test.ts ai-agent-action-schema.test.ts`

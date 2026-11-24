---
title: AI Agent Sales Persona and Chat-Based Training
date: 2026-11-23
summary: "Implemented 8-phase AI Agent sales profile, chat-based training proposal/apply/revert, 4-section runtime prompt compiler, buffered 2-tier reply guard, template remapping, public/private API, CLI/MCP, and builder training UI."
---

# AI Agent Sales Persona and Chat-Based Training

## What happened
Implemented the full 8-phase plan `plans/261123-1947-ai-agent-sales-persona` ("AI Agent sales persona and goal, taught by chat"):
1. **Data Model & Service (`@chatbotx.io/database`, `@chatbotx.io/business`):**
   - Added `salesProfile` (`jsonb`) and `salesProfileVersion` (`integer`, default `0`) to `AIAgent`.
   - Created `AIAgentSalesProfileVersion` and `AIAgentTrainingMessage` tables, relations (imported and spread in `relations/index.ts`), repositories, and bounded workspace purge entries (`HEAVY_WORKSPACE_TABLES`).
   - Generated migration `20261123200331_ai_agent_sales_profile` (not applied automatically per migration safety rule).
   - Built `aiAgentSalesProfileService` (`get`, `update`, `listVersions`, `revert`, `appendMessages`, `listMessages`, `markApplied`, `clear`).
2. **Instruction -> Proposal (`@chatbotx.io/ai/sales-profile-proposer`, `@chatbotx.io/business`):**
   - Exposed `generateSalesProfileProposalPatch` under a dedicated Edge-safe package subpath `@chatbotx.io/ai/sales-profile-proposer` so the builder Edge instrumentation graph never reaches Node-only `node:crypto` in `@chatbotx.io/ai/server`.
   - Built `aiAgentSalesProfileProposalService.propose` with rate limiting, bot-message quota enforcement, active catalog lookup (up to 50), 20-message training history context, server-side product ownership verification, diff generation, and atomic training message persistence.
3. **Public API, Private API, CLI & MCP (`apps/builder`, `apps/cli`):**
   - Added 8 procedures under `aiAgentsPublicRouter.salesProfile` and `aiAgentsAuthenticatedAPI` (`get`, `update`, `propose`, `apply`, `versions`, `revert`, `listTrainingMessages`, `clearTrainingMessages`).
   - Added CLI command-name overrides in `apps/cli/src/openapi-loader.ts` and documented them in `apps/cli/README.md`.
4. **Runtime Prompt, Sales State & 2-Tier Reply Guard (`apps/worker`):**
   - Built `compileSalesPrompt` (4 fixed sections) and `conversationService.updateSalesState` (`jsonb_set` on `{salesState}` preserving `{challenge}`).
   - Wired buffered reply mode (`sendParts: false`) and rich-reply text extraction behind `salesProfile.enabled`, feeding `evaluateSalesGuard` (Tier 1 Unicode-aware VND/USD price & percent verifier + Tier 2 4s deadline structured judge with fail-open, at most one rewrite, fallback line, and `handoffExecutorService.execute` on human request or off-topic streak limit).
5. **Templates, Builder UI & 30-Scenario Eval:**
   - Updated `aiAgentsAdapter` to snapshot `salesProfile`, remap `targetProducts[].productId` via `ctx.idMaps.product`, warn on dropped products, and auto-disable when all target products are dropped.
   - Added the `Sales Training` tab in `UpdateAIAgentDialog` (`training-chat.tsx`, `proposal-card.tsx`, `sales-profile-view.tsx`, `version-history.tsx`) and i18n keys across all 20 locale files.
   - Verified all 32 Vietnamese scenarios in `sales-scenarios.eval.test.ts` and documented the feature and manual bot re-enable runbook in `docs/ai-agent-sales-profile.md`.
6. **CB-5 Production Readiness Refinements (2026-11-24):**
   - Added `handoffMessage` (default `"Anh/chị đợi em một chút, em làm thủ tục đăng ký ạ"`) and `handoffTriggers` to `aiAgentSalesProfileSchema` (JSONB, no new SQL migration required), `salesProfilePublicSchema`, `salesProfileProposalOutputSchema`, `SalesProfileView`, and all 20 locale files.
   - Added `buildSalesHandoffPolicy` in `packages/ai/src/server/prompt-utils.ts` and replaced `aiPolicies.handoff` when `salesProfile.enabled` is true (keeping `aiPolicies.handoff` unchanged for agents without an active sales profile).
   - Updated `evaluateSalesGuard` to send `handoffMessage` **before** calling `handoffExecutorService.execute` in both the human-request and off-topic-streak-limit branches.
   - Extended Tier 2 judge and deterministic checks (`isCustomerAskingBotOrHuman`, `containsBotSelfDisclosure`) so `"bot à / người thật không"` triggers human handover and any reply containing `"bot"`, `"AI"`, `"trợ lý ảo"`, or `"human agent"` is flagged as an `inRole` violation and rewritten/stripped.

## Decision
- Kept `@chatbotx.io/ai/sales-profile-proposer` isolated from `packages/ai/src/server/factory.ts` (`Buffer`) and `ai-context-service.ts` (`node:crypto`) to preserve Invariant 25 (`edge-instrumentation-graph.test.ts`).
- Used Unicode-aware word boundaries `(?=$|[^\p{L}\p{N}_])` with the `/u` flag in Tier 1 money extraction so Vietnamese currency suffixes (`đ`, `₫`, `đồng`) are reliably matched.

## Next steps
- Await explicit user approval before running `pnpm --filter @chatbotx.io/database db:migrate` to apply `20261123200331_ai_agent_sales_profile`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

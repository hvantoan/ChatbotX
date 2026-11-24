---
title: "Plan: AI Agent sales persona taught by chat"
date: 2026-11-23
summary: "Planned a structured, versioned salesProfile per AI Agent with a training chat, compiled prompt, buffered two-tier reply guard and handover."
---

# Plan: AI Agent sales persona taught by chat

## What happened
Planned how admins teach an AI Agent its tone, role and sales goal by chatting in the builder. The plan is at `plans/261123-1947-ai-agent-sales-persona/` (8 phases, about 9.5 days). Scouting turned up three constraints:
- AI replies are sent paragraph by paragraph while streaming (`apps/worker/src/integration/handlers/automated-response/replies.ts:934`, `sendParts: true`), so a reply cannot be checked before sending unless it is buffered.
- AI Agents are template-copied (`packages/database/src/partials/template.ts:31`), so the Product IDs in a profile must be remapped or dropped on install.
- Handoff can already be reached from the reply path through `handoffExecutorService.execute` (`replies.ts:418`).

## Decision
- The LLM only proposes a structured `salesProfile` patch. Code compiles the prompt, and the LLM never rewrites `AIAgent.prompt`.
- Prices come only from Product and variant rows, read at reply time.
- Buffered send and the two-tier guard apply only to agents with an active profile. Tier 1 is a deterministic price check. Tier 2 uses the agent's own model with about 150 output tokens and fails open to tier 1.
- The sales stage lives in `conversation.additionalAttributes.salesState` and is written with `jsonb_set`, following the `challenge` pattern.
- The training chat is persisted in a new `AIAgentTrainingMessage` table. Profile versions go in `AIAgentSalesProfileVersion`.

## Next steps
- Confirm the rich-mode guard hook point in `rich-reply.ts`. It is the only claim still marked [UNVERIFIED].
- Review the generated migration SQL before anyone applies it.
- Implement with `/ak-cook plans/261123-1947-ai-agent-sales-persona/plan.md`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

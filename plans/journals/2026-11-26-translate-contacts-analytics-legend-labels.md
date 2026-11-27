---
title: Translate contacts analytics legend labels
date: 2026-11-26
summary: Mapped contacts dashboard chart dimensions through existing channel and contact-source translations.
---

# Translate contacts analytics legend labels

## What happened
Fixed the contacts dashboard donut-chart legends that displayed raw analytics dimension values such as `inboundMessage`, `zalo_personal`, and `api`. Added `packages/analytics-nextjs/src/utils/dimension-label.ts` and used it in the all-contacts-by-channel, new-contacts-by-channel, and contacts-by-source charts so dimensions resolve through existing `fields.<channel>.label` and `condition.sources.<source>` translations, with the raw value as fallback and `analytics.unknown` for empty dimensions.

## Verification
- Confirmed every locale already has all current channel and contact-source translation keys.
- `pnpm --filter @inboxos.io/analytics-nextjs test -- dimension-label.test.ts` passed: 12 files, 120 tests.
- `pnpm exec ultracite check ...` passed for the five touched files.
- `pnpm --filter @inboxos.io/analytics-nextjs check-types` passed.

## Next steps
None.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

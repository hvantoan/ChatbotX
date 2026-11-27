---
title: Add workspace list padding
date: 2026-11-26
summary: Added breathing room around the home workspace card list and verified formatting.
---

# Add workspace list padding

## What happened
Applied the page feedback for the home workspace list by changing the workspace card grid in `apps/builder/src/features/workspaces/components/workspaces-list.tsx` from no horizontal padding to `p-2`, giving cards room for hover, shadow, and focus-ring rendering inside the scroll container.

## Verification
Ran `pnpm exec ultracite check apps/builder/src/features/workspaces/components/workspaces-list.tsx`; it passed with no fixes applied.

## Next steps
None.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

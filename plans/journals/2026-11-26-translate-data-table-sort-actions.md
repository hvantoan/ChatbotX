# Journal: Translate shared data-table sorting actions

Date: 2026-11-26
Status: completed

## What changed

The sorting dropdown used by table column headers no longer hardcodes English menu labels. This fixes the untranslated sort menu visible on `/space/.../automated-responses` (for example on the keyword column) and applies the same correction to every table using the shared `DataTableColumnHeader`.

`packages/ui` now supports these optional data-table labels:

- `sortAscending`
- `sortDescending`
- `resetSorting`
- `hideColumn`

`DataTableColumnHeader` reads those labels through the existing `DataTableLabelsProvider`/`useDataTableLabels` pattern, preserving English fallbacks for consumers outside the builder.

The builder-wide `DataTableLabelsBridge` now supplies translations for the new labels. Added `actions.sortAscending`, `actions.sortDescending`, and `actions.hideColumn` to all 21 locale files; `resetSorting` reuses the existing `actions.reset` translation. English values intentionally remain `Asc`, `Desc`, and `Hide` to preserve existing copy while other locales receive localized labels.

## Root cause

`packages/ui/src/components/data-table/data-table-column-header.tsx` rendered literal `Asc`, `Desc`, `Reset`, and `Hide` strings. `packages/ui` is intentionally independent of next-intl, so translations must enter it through the existing labels-provider bridge owned by the builder app.

## Files changed

- `packages/ui/src/components/data-table/data-table-labels.tsx`
- `packages/ui/src/components/data-table/data-table-column-header.tsx`
- `packages/ui/__tests__/data-table-labels.test.tsx`
- `apps/builder/src/components/data-table-labels-bridge.tsx`
- `apps/builder/messages/*.json` (21 locales)
- `plans/journals/2026-11-26-translate-data-table-sort-actions.md`

## Verification

- `pnpm --filter builder i18n:check` — passed; no missing or invalid translations.
- `python3 -m json.tool apps/builder/messages/en.json` — valid JSON.
- `pnpm --filter @inboxos.io/ui exec vitest run __tests__/data-table-labels.test.tsx` — passed, 4/4 tests. The provider-label test opens the column sorting menu and verifies localized ascending, descending, reset-sorting, and hide-column labels.
- `pnpm --filter @inboxos.io/ui check-types` — passed.
- Targeted `pnpm exec ultracite check` for the touched TypeScript/TSX files — passed.
- Full builder TypeScript check was attempted, but `tsc` was SIGKILLed by the machine before completion. The builder check is repo-wide and memory-heavy; this environment currently has little free memory and nearly full swap. The builder-side change is limited to adding four string-valued properties to an existing translation object.

## Remaining notes

- No visual browser verification was performed; no local builder dev server was available in this session.
- The unrelated pre-existing hardcoded table-toolbar label `aria-label="Reset filters"` in `packages/ui` was not changed because it is outside this feedback item.

---
title: base-ui-shadcn-synchronization
date: 2026-11-24
summary: "Synchronized ChatbotX UI layer onto Shadcn UI + @base-ui/react with mechanical guardrails"
---

# base-ui-shadcn-synchronization

## What happened
- Unified `components.json` to `packages/ui/components.json` (`base-vega`) and removed `apps/builder/components.json`.
- Fixed Radix leftovers (`data-[state=*]`, `data-[active=true]`, `hsl(var(--...))`) across `packages/ui` and 14+ sites in `apps/builder`, fixed `HoverCardContent` and `MenubarContent` Positioner prop forwarding, moved `CommandDialog` `DialogHeader` inside `DialogContent`, fixed `FormFieldContext`/`FormControl` (while keeping standalone `<FormLabel>` support for `CustomFieldSelect` and `ReplyTextsField`), removed undefined `cn-font-heading`, and added `"use client"` to 14 component files in `packages/ui`.
- Unified CSS tokens (`--radius: 0.625rem`, dark `--background: oklch(0.145 0 0)`, `--destructive-foreground` across all 36 `.theme-*` blocks), aligned overlay animations onto Base UI native `data-starting-style` / `data-ending-style`, refactored `TabsList` (removed inner `<div>` wrapper and added `variant="line" | "pills"`), made `Toaster` RTL-aware, and patched `sersavan/multi-select.tsx`, `muhammada86/tags-input-field.tsx`, and `vatsalpipalava/input-color.tsx` in place.
- Removed 7 dead 0-consumer files (`nested-dialog`, `editable`, `stepper`, `field`, `combobox`, `listbox`, `create-message-template-form._tsx`) and 5 unused/duplicate packages (`@diceui/*`, `@stepperize/react`, `framer-motion`), closed `@base-ui/react` boundary out of `apps/builder`, converted 4 raw `<table>` elements and 2 trivial `<FormField>` dialogs, localized `auth.signedInSuccess` across 21 locale files, and added mechanical guardrails in `biome.json` and `scripts/check-invariants.mjs`.

## Verification
- `pnpm --filter @chatbotx.io/ui check-types` and `pnpm --filter @chatbotx.io/ui test`: passed (23 files, 103 tests).
- `CHECK_TYPES_SKIP_TESTS=1 pnpm --filter builder check-types`: passed (`pnpm --filter builder check-types` hits 1 pre-existing untouched error at `__tests__/ai-agent-sales-training.test.tsx:219`).
- `pnpm --filter builder test`: 1189/1191 files passed on initial full run; after fixing `useFormField` and updating the `PopoverContent` snapshot, both `__tests__/optional-field-marker.test.tsx` and `__tests__/plain-text-tiptap-editor-dom.test.tsx` passed.
- `pnpm check:invariants` (8123 source files) and `builder#lint` (`i18n:check` across 21 locales) passed; full `ultracite check` reported 2 unrelated errors in pre-existing uncommitted files (`apps/worker/.../sales-guard.ts`, `packages/ai/.../prompt-utils.ts`).

## Next steps
- Visual smoke test on Light/Dark/RTL (`ar`)/tenant themes in `pnpm --filter builder dev` (especially before considering removal of `body { pointer-events: auto !important; }` in `default.css`).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

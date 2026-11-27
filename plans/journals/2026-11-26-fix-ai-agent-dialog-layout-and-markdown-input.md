---
title: Fix AI agent dialog layout and markdown input
date: 2026-11-26
summary: "Reworked AI agent dialogs with fixed header/footer and scrolling bodies, while preserving Markdown syntax in prompt editors."
---

# Fix AI agent dialog layout and markdown input

## What happened
Fixed the AI agent create/edit dialog feedback. The dialogs now use a near-full-viewport responsive layout (`100dvh` minus gutter), wider tablet/desktop widths, a fixed header with a bottom border, a scrollable body region, and a fixed footer. The edit dialog keeps the General/Training tab bar fixed while each tab scrolls inside the dialog. Popover height calculations now use `100dvh` consistently.

Also treated the instruction and example-message inputs as Markdown source editors. `PlainTextEditorField` now forwards the existing `plainText` mode to `PlainTextTiptapEditor`; the AI agent prompt and message fields enable it and use larger monospace editing areas. Typed Markdown such as headings, lists, emphasis markers, and backticks is preserved verbatim instead of being consumed by tiptap input rules.

## Verification
- `pnpm exec ultracite check` on the three touched source files passed.
- `pnpm --filter builder exec vitest run __tests__/plain-text-tiptap-editor.test.ts` passed: 11 tests. jsdom printed its known canvas warning.
- `pnpm --filter builder exec vitest run __tests__/plain-text-tiptap-editor-dom.test.tsx` passed: 2 tests.
- The first full builder typecheck was killed with exit 137 under memory pressure. A retry with `--max-old-space-size=4096` completed successfully.
- No dev server was running locally, so visual confirmation in a browser was not performed.

## Next steps
If “Markdown editor” meant a rendered preview or formatting toolbar rather than a Markdown source editor, that remains a separate product decision.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.

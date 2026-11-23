---
title: "Phase 3: Manifest, Snapshots & Docs"
status: completed
---

# Phase 3: Manifest, Snapshots & Docs

## Overview

Update the API parity manifest, verify OpenAPI spec/MCP/CLI invariants and command-name collisions, update CLI/operator documentation (including env opt-out and disconnect reference-guard risk), and pass the full verification suite.

## Requirements

- [x] `apps/builder/__tests__/api-parity-manifest.json` marks all 4 `integration-openai-compatible/*` actions as `covered:connections` or `covered:integrations` (0 `private:` entries)
- [x] `public-spec-operations.test.ts`, `public-spec-mcp.test.ts`, `edge-instrumentation-graph.test.ts`, and `apps/cli/__tests__/openapi-loader-command-names.test.ts` pass
- [x] `apps/cli/README.md` documents `openaiCompatible` usage with `integrations find-by-ai` and `integrations update-ai`
- [x] Docs note `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS` self-host opt-out and the disconnect reference-guard risk (`connections.disconnect` / `DELETE /v1/connections/{id}` does not block disconnecting an integration still referenced by an AI agent)

## Implementation Steps

1. Update `apps/builder/__tests__/api-parity-manifest.json` for all 4 `integration-openai-compatible/*` entries.
2. Run spec, MCP, parity, edge-graph, and CLI command-name tests; update snapshot only if route metadata snapshot changed.
3. Update `apps/cli/README.md` (`integrations` section) and operator docs for `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS` and disconnect reference-guard risk.
4. Run full verification: `pnpm lint`, `pnpm check-types`, and targeted package/app tests.

## Verification

- `pnpm --filter builder test -- api-parity-manifest.test.ts public-spec-operations.test.ts public-spec-mcp.test.ts edge-instrumentation-graph.test.ts`
- `pnpm --filter chatbotx test`
- `pnpm lint`
- `pnpm check-types`

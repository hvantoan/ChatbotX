import { createSpecLoader, type DynamicTool } from "@inboxos.io/openapi-catalog"
import { env } from "./env"
import type { TokenIntrospection } from "./token-introspection"

export type { DynamicTool } from "@inboxos.io/openapi-catalog"
export {
  isWorkspaceTokenOperation,
  toSnakeCase,
} from "@inboxos.io/openapi-catalog"

/**
 * The process-wide catalog loader. The parsing, fetching, ETag revalidation
 * and dedup logic lives in `@inboxos.io/openapi-catalog`, shared with the CLI
 * and the worker — this module only binds the MCP server's env config and the
 * scope-based `tools/list` filtering, which is MCP-specific.
 *
 * `includeConfirmInput` is the MCP server's hitl gate: its catalog is the only
 * one whose input schemas carry the synthetic `_confirm` field. The worker's
 * catalog never does — the Master Agent's confirmation is server-side.
 */
const loader = createSpecLoader({
  apiUrl: env.INBOXOS_API_URL,
  ttlMs: env.INBOXOS_SPEC_TTL_MS,
  httpTimeoutMs: env.INBOXOS_HTTP_TIMEOUT_MS,
  includeConfirmInput: true,
})

export const loadOpenApiSpec = (): Promise<DynamicTool[]> => loader.load()

/**
 * Call on every `tools/list` (cheap when fresh: one `Date.now()` comparison,
 * no network call) so a spec change on the server side — a new endpoint, a
 * renamed operation — shows up without restarting the MCP server.
 */
export const refreshOpenApiSpecIfStale = (): Promise<DynamicTool[]> =>
  loader.refreshIfStale()

export const getCachedTools = (): DynamicTool[] => loader.getTools()

export const getToolByName = (name: string): DynamicTool | undefined =>
  loader.getToolByName(name)

function isVisibleForScope(
  tool: DynamicTool,
  introspection: TokenIntrospection | null,
): boolean {
  // Fail OPEN: introspection unavailable (network blip, unexpected
  // response) must not hide every tool — enforcement of scope/permission
  // still happens server-side on the actual call; this is a `tools/list`
  // display concern only.
  if (introspection === null) {
    return true
  }

  // `readOnlyHint` (method-inferred for GET, or explicit `x-mcp.readOnlyHint`
  // for a POST that's actually a read in disguise) is the single source of
  // truth here — no separate allowlist to keep in sync.
  if (
    introspection.permission === "read_only" &&
    !tool.annotations.readOnlyHint
  ) {
    return false
  }

  // `alwaysVisible` (discovery endpoints like `capabilities.get`/`token.get`)
  // and an unrestricted token (`scopes: null`) both skip the scope check.
  if (tool.alwaysVisible || introspection.scopes === null) {
    return true
  }

  if (tool.scope === undefined) {
    return false
  }
  const requiredScopes = Array.isArray(tool.scope) ? tool.scope : [tool.scope]
  const grantedScopes = introspection.scopes
  return requiredScopes.some((scope) => grantedScopes.includes(scope))
}

/**
 * The `tools/list` surface — `visibility: "default"` operations only,
 * further narrowed to what `introspection` (the calling token's
 * permission/scopes, from `GET /v1/token`) allows when provided. Everything
 * excluded here is still reachable via `search_tools` / `call_tool` against
 * `getCachedTools()`, which is never filtered.
 */
export function getVisibleTools(
  introspection?: TokenIntrospection | null,
): DynamicTool[] {
  return getCachedTools().filter(
    (tool) =>
      tool.visibility === "default" &&
      isVisibleForScope(tool, introspection ?? null),
  )
}

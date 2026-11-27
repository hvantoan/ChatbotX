import { type ParseToolsOptions, parseToolsFromSpec } from "./parse"
import type { DynamicTool, OpenAPISpec } from "./types"

export type SpecLoaderOptions = {
  /** `/api` base URL the spec is fetched from (`<apiUrl>/public-spec.json`). */
  apiUrl: string
  /** Milliseconds before the cached spec is re-fetched in the background. */
  ttlMs: number
  /** Per-request HTTP timeout in milliseconds. */
  httpTimeoutMs: number
  /**
   * Adds the synthetic `_confirm` input for the MCP server's hitl gate.
   * Every other consumer must leave this false.
   */
  includeConfirmInput?: boolean
  /** Operation id prefixes dropped from the catalog (default `masterAgent.`). */
  excludeOperationIdPrefixes?: readonly string[]
  /**
   * Sink for human-readable loader events (duplicate names, refresh failures).
   * Defaults to stderr so a stdio MCP transport stream stays clean.
   */
  log?: (message: string) => void
  /** Injectable for tests. */
  fetchFn?: typeof fetch
}

export type SpecLoader = {
  /**
   * The full parsed catalog, fetching on first use. Throws when the first
   * fetch fails — there is nothing to fall back to.
   */
  load: () => Promise<DynamicTool[]>
  /**
   * Cheap on every call when fresh; revalidates with `If-None-Match` once the
   * TTL expires, coalescing concurrent refreshes onto one in-flight fetch and
   * keeping the last good catalog when a background refresh fails.
   */
  refreshIfStale: () => Promise<DynamicTool[]>
  /** The current catalog without fetching (empty before the first load). */
  getTools: () => DynamicTool[]
  getToolByName: (name: string) => DynamicTool | undefined
}

const defaultLog = (message: string) => {
  console.error(message)
}

/**
 * A per-instance spec loader. Each consumer (MCP server, CLI, Master Agent
 * worker) builds its own instance with its own apiUrl/TTL, so no process
 * leaks its cache into another consumer the way the old module-level
 * singletons did per process.
 */
export function createSpecLoader(options: SpecLoaderOptions): SpecLoader {
  const specUrl = `${options.apiUrl}/public-spec.json`
  // Look up the global at call time, not at construction: tests swap
  // `globalThis.fetch` after the module is already loaded.
  const fetchFn: typeof fetch = options.fetchFn ?? ((...args) => fetch(...args))
  const log = options.log ?? defaultLog
  const parseOptions: Omit<ParseToolsOptions, "fallbackBaseUrl"> = {
    includeConfirmInput: options.includeConfirmInput,
    ...(options.excludeOperationIdPrefixes
      ? { excludeOperationIdPrefixes: options.excludeOperationIdPrefixes }
      : {}),
  }

  let cachedTools: DynamicTool[] | null = null
  const toolsByName = new Map<string, DynamicTool>()
  let cachedEtag: string | null = null
  let fetchedAtMs = 0
  // Coalesces concurrent refresh attempts (e.g. several `tools/list` calls
  // landing after the TTL expires) onto one in-flight fetch instead of firing
  // one HTTP request per caller.
  let refreshInFlight: Promise<DynamicTool[]> | null = null

  /**
   * Fetches the spec with a conditional `If-None-Match` when we already hold
   * an ETag. A 304 means the previously parsed `cachedTools` are still
   * current — the response body is empty, so re-parsing isn't needed or
   * possible. `fetchedAtMs` is bumped either way so the TTL window restarts
   * from the moment freshness was confirmed, not just from the last real body
   * fetch.
   */
  async function fetchAndParseSpec(): Promise<DynamicTool[]> {
    const response = await fetchFn(specUrl, {
      headers: {
        Accept: "application/json",
        ...(cachedEtag ? { "If-None-Match": cachedEtag } : {}),
      },
      signal: AbortSignal.timeout(options.httpTimeoutMs),
    })

    if (response.status === 304 && cachedTools !== null) {
      fetchedAtMs = Date.now()
      return cachedTools
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch OpenAPI spec from ${specUrl}: ${response.status} ${response.statusText}`,
      )
    }

    const spec = (await response.json()) as OpenAPISpec
    const tools = parseToolsFromSpec(spec, {
      fallbackBaseUrl: options.apiUrl,
      ...parseOptions,
    })

    toolsByName.clear()
    const deduplicatedTools: DynamicTool[] = []
    for (const tool of tools) {
      if (toolsByName.has(tool.name)) {
        log(
          `Duplicate MCP tool name "${tool.name}" in OpenAPI spec; keeping the first operation.`,
        )
        continue
      }
      toolsByName.set(tool.name, tool)
      deduplicatedTools.push(tool)
    }

    cachedTools = deduplicatedTools
    cachedEtag = response.headers.get("ETag")
    fetchedAtMs = Date.now()
    log(`Loaded ${deduplicatedTools.length} tools from OpenAPI spec`)
    return deduplicatedTools
  }

  return {
    load: async () => {
      if (cachedTools !== null) {
        return cachedTools
      }
      return await fetchAndParseSpec()
    },

    /**
     * A failed background refresh logs and keeps serving the last good
     * catalog rather than surfacing the error to the caller — a transient API
     * blip must not take down tool listing for every connected session.
     */
    refreshIfStale: async () => {
      if (cachedTools === null) {
        if (!refreshInFlight) {
          refreshInFlight = fetchAndParseSpec().finally(() => {
            refreshInFlight = null
          })
        }
        return await refreshInFlight
      }

      const isStale = Date.now() - fetchedAtMs >= options.ttlMs
      if (!isStale) {
        return cachedTools
      }

      if (!refreshInFlight) {
        refreshInFlight = fetchAndParseSpec()
          .catch((error: unknown) => {
            log(
              `Background OpenAPI spec refresh failed, keeping previous tool list: ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
            return cachedTools ?? []
          })
          .finally(() => {
            refreshInFlight = null
          })
      }

      return await refreshInFlight
    },

    getTools: () => cachedTools ?? [],
    getToolByName: (name) => toolsByName.get(name),
  }
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  type DynamicTool as CatalogTool,
  parseToolsFromSpec,
  pathAndMethodToCommandName,
} from "@inboxos.io/openapi-catalog"

export {
  isWorkspaceTokenOperation,
  pathAndMethodToCommandName,
} from "@inboxos.io/openapi-catalog"

/**
 * The CLI's projection of one catalog operation: the shared parse output plus
 * the derived command name. Parsing (security filtering, input schema,
 * allOf/anyOf body resolution) lives in `@inboxos.io/openapi-catalog`, shared
 * with the MCP server and the worker — this module only owns the CLI's
 * command naming and its on-disk cache.
 */
export interface DynamicTool {
  baseUrl: string
  bodyParamNames: string[]
  commandName: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
  method: string
  pathParamNames: string[]
  pathTemplate: string
  queryParamNames: string[]
}

interface SpecCache {
  fetchedAt: number
  tools: DynamicTool[]
  url: string
}

const CACHE_DIR = join(homedir(), ".inboxos")
const CACHE_FILE = join(CACHE_DIR, "openapi-cache.json")
const DEFAULT_TTL_SECONDS = 3600

function getTtlSeconds(): number {
  const raw = process.env.INBOXOS_SPEC_CACHE_TTL_SECONDS
  if (!raw) {
    return DEFAULT_TTL_SECONDS
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? DEFAULT_TTL_SECONDS : parsed
}

function readCache(specUrl: string): DynamicTool[] | null {
  try {
    const raw = readFileSync(CACHE_FILE, "utf8")
    const cache = JSON.parse(raw) as SpecCache
    if (cache.url !== specUrl) {
      return null
    }
    const ageSeconds = (Date.now() - cache.fetchedAt) / 1000
    if (ageSeconds > getTtlSeconds()) {
      return null
    }
    return cache.tools
  } catch {
    return null
  }
}

function writeCache(specUrl: string, tools: DynamicTool[]): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true })
    const cache: SpecCache = { url: specUrl, fetchedAt: Date.now(), tools }
    writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8")
  } catch {
    // Cache write failure is non-fatal
  }
}

const toCliTool = (tool: CatalogTool): DynamicTool => ({
  baseUrl: tool.baseUrl,
  bodyParamNames: tool.bodyParamNames,
  commandName: pathAndMethodToCommandName(tool.pathTemplate, tool.method),
  // The annotations title is the operation summary (falling back to the
  // operationId), which is the short help text the CLI has always shown.
  description: tool.annotations.title,
  inputSchema: tool.inputSchema,
  method: tool.method,
  pathParamNames: tool.pathParamNames,
  pathTemplate: tool.pathTemplate,
  queryParamNames: tool.queryParamNames,
})

export async function loadOpenApiSpecForCli(
  apiUrl: string,
  forceRefresh = false,
): Promise<DynamicTool[]> {
  const specUrl = `${apiUrl}/public-spec.json`

  if (!forceRefresh) {
    const cached = readCache(specUrl)
    if (cached) {
      // Names are re-derived on every load so a cache written by an older CLI
      // picks up naming changes (e.g. COMMAND_NAME_OVERRIDES) immediately.
      return cached.map((tool) => ({
        ...tool,
        commandName: pathAndMethodToCommandName(tool.pathTemplate, tool.method),
      }))
    }
  }

  const response = await fetch(specUrl, {
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenAPI spec from ${specUrl}: ${response.status} ${response.statusText}`,
    )
  }

  const spec = (await response.json()) as Parameters<
    typeof parseToolsFromSpec
  >[0]
  const tools = parseToolsFromSpec(spec, { fallbackBaseUrl: apiUrl }).map(
    toCliTool,
  )

  writeCache(specUrl, tools)
  return tools
}

import {
  type DynamicTool,
  type DynamicToolAnnotations,
  isWorkspaceTokenOperation,
  type McpHitlPolicy,
  type McpOperationMeta,
  type OpenAPIOperation,
  type OpenAPISchemaObject,
  type OpenAPISpec,
  toSnakeCase,
} from "./types"

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
])
/**
 * Operations under these `operationId` prefixes are excluded from the parsed
 * catalog. Empty by default: the CLI and the MCP server expose the
 * `masterAgent.*` surface like any other. The Master Agent worker passes
 * `["masterAgent."]` — an agent driving the catalog must never call back into
 * the chat that spawned it (a `masterAgent.sendMessage` call from inside a
 * Master Agent turn would queue a turn that queues a turn).
 */
const EXCLUDED_OPERATION_ID_PREFIXES: readonly string[] = []
export type ParseToolsOptions = {
  /**
   * Base URL tools fire against when the spec carries no `servers` entry.
   * Typically the same `/api` URL the spec itself was fetched from.
   */
  fallbackBaseUrl: string
  /**
   * Forces the base URL tools fire against, ignoring the spec's advertised
   * `servers[0].url`. A worker that reaches the API over an internal address
   * must not execute against the public URL the spec advertises.
   */
  baseUrlOverride?: string
  /**
   * Add the synthetic `_confirm` input to confirmation-gated tools. Only the
   * MCP server wants this: its hitl gate lets a model self-confirm. Every
   * other consumer (CLI, Master Agent worker) either ignores the policy or
   * enforces it server-side, and a `_confirm` the model supplies there must
   * not exist in the schema at all.
   */
  includeConfirmInput?: boolean
  /**
   * Operation id prefixes dropped from the catalog. Defaults to none — see
   * `EXCLUDED_OPERATION_ID_PREFIXES`.
   */
  excludeOperationIdPrefixes?: readonly string[]
}

function extractPathParamNames(pathTemplate: string): string[] {
  const matches = pathTemplate.match(/\{([^}]+)\}/g)
  return matches ? matches.map((m) => m.slice(1, -1)) : []
}

/**
 * `x-mcp` hints override; otherwise inferred from the HTTP method — a GET is
 * read-only and idempotent by convention, a DELETE is destructive (and still
 * idempotent: deleting twice is a no-op), everything else (POST/PUT/PATCH)
 * defaults to none of the three.
 */
function buildAnnotations(
  method: string,
  operation: OpenAPIOperation,
  fallbackTitle: string,
): DynamicToolAnnotations {
  const meta = operation["x-mcp"]
  const upperMethod = method.toUpperCase()
  return {
    title: operation.summary?.trim() || fallbackTitle,
    readOnlyHint: meta?.readOnlyHint ?? upperMethod === "GET",
    destructiveHint: meta?.destructiveHint ?? upperMethod === "DELETE",
    idempotentHint:
      meta?.idempotentHint ??
      (upperMethod === "GET" ||
        upperMethod === "PUT" ||
        upperMethod === "DELETE"),
    openWorldHint:
      meta?.openWorldHint ?? meta?.hitlPolicy === "confirm_outbound",
  }
}

const resolveHitlPolicy = (
  meta: McpOperationMeta | undefined,
  annotations: DynamicToolAnnotations,
): McpHitlPolicy =>
  meta?.hitlPolicy ?? (annotations.readOnlyHint ? "none" : "confirm_diff")

/**
 * Guide names the catalog may reference from a tool description, keyed by the
 * OpenAPI tag that maps to them. The overview guide is deliberately not a
 * target: it describes MCP discovery itself, not a resource workflow.
 */
export type TaggedGuideName =
  | "contacts-and-pipelines"
  | "flows-and-automation"
  | "inbox-and-handover"

const GUIDE_BY_TAG: Partial<Record<string, TaggedGuideName>> = {
  Broadcasts: "flows-and-automation",
  Contacts: "contacts-and-pipelines",
  Conversations: "inbox-and-handover",
  Flows: "flows-and-automation",
  "Inbox Teams": "inbox-and-handover",
  Pipelines: "contacts-and-pipelines",
  Teams: "inbox-and-handover",
}

/**
 * `summary` is the short, always-present label; `description` (when a route
 * sets one) carries the long-form usage guidance an agent needs to pick the
 * right tool — example payloads, valid values, edge cases. Joining both
 * (instead of preferring one) means an endpoint author never has to choose
 * which one the MCP tool actually sees.
 */
function buildToolDescription(
  operation: OpenAPIOperation,
  meta: McpOperationMeta | undefined,
  annotations: DynamicToolAnnotations,
): string {
  const parts = [operation.summary, operation.description].filter(
    (part): part is string => Boolean(part),
  )
  const requirements: string[] = []
  if (meta?.scope) {
    const scopes = Array.isArray(meta.scope)
      ? meta.scope.join(" or ")
      : meta.scope
    requirements.push(`Requires token scope: ${scopes}.`)
  }
  if (!annotations.readOnlyHint) {
    requirements.push("Requires a full (non read-only) token.")
  }
  const guideName = operation.tags
    ?.map((tag) => GUIDE_BY_TAG[tag])
    .find((candidate): candidate is TaggedGuideName => candidate !== undefined)
  if (guideName) {
    requirements.push(
      `For the operational procedure, call get_guide with name "${guideName}".`,
    )
  }
  if (requirements.length > 0) {
    parts.push(requirements.join("\n"))
  }

  return parts.length > 0 ? parts.join("\n\n") : (operation.operationId ?? "")
}

const resolveBodySchema = (
  bodySchema: OpenAPISchemaObject | undefined,
):
  | {
      properties: Record<string, OpenAPISchemaObject>
      required: string[]
    }
  | undefined => {
  if (!bodySchema) {
    return
  }

  if (bodySchema.properties) {
    return {
      properties: bodySchema.properties,
      required: bodySchema.required ?? [],
    }
  }

  if (bodySchema.allOf) {
    const properties: Record<string, OpenAPISchemaObject> = {}
    const required: string[] = []
    for (const branch of bodySchema.allOf) {
      for (const [key, value] of Object.entries(branch.properties ?? {})) {
        properties[key] = value
      }
      for (const key of branch.required ?? []) {
        if (!required.includes(key)) {
          required.push(key)
        }
      }
    }
    return Object.keys(properties).length > 0
      ? { properties, required }
      : undefined
  }

  const variants = [...(bodySchema.anyOf ?? []), ...(bodySchema.oneOf ?? [])]
  if (variants.length === 0) {
    return
  }

  const properties: Record<string, OpenAPISchemaObject> = {}
  for (const branch of variants) {
    for (const [key, value] of Object.entries(branch.properties ?? {})) {
      properties[key] = value
    }
  }
  // Branch requirements are intentionally omitted: per-property anyOf wrappers
  // would be more precise, but are noisier for an LLM tool schema.
  return Object.keys(properties).length > 0
    ? { properties, required: [] }
    : undefined
}

function buildInputSchema(operation: OpenAPIOperation): {
  schema: DynamicTool["inputSchema"]
  bodyParamNames: string[]
  queryParamNames: string[]
} {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  const bodyParamNames: string[] = []
  const queryParamNames: string[] = []

  for (const param of operation.parameters ?? []) {
    if (param.in !== "path" && param.in !== "query") {
      continue
    }
    const schema: Record<string, unknown> = {
      ...(param.schema ?? { type: "string" }),
    }
    if (param.description) {
      schema.description = param.description
    }
    properties[param.name] = schema
    if (param.required || param.in === "path") {
      required.push(param.name)
    }
    if (param.in === "query") {
      queryParamNames.push(param.name)
    }
  }

  const bodySchema = resolveBodySchema(
    operation.requestBody?.content?.["application/json"]?.schema,
  )
  if (bodySchema) {
    for (const [key, value] of Object.entries(bodySchema.properties)) {
      properties[key] = value
      bodyParamNames.push(key)
    }
    for (const key of bodySchema.required) {
      if (!required.includes(key)) {
        required.push(key)
      }
    }
  }

  return {
    schema: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
    bodyParamNames,
    queryParamNames,
  }
}

function parseOperation(
  pathTemplate: string,
  method: string,
  operation: OpenAPIOperation,
  baseUrl: string,
  includeConfirmInput: boolean,
): DynamicTool | null {
  if (
    !operation.operationId ||
    operation.deprecated ||
    !isWorkspaceTokenOperation(operation)
  ) {
    return null
  }

  const operationId = operation.operationId

  const { schema, bodyParamNames, queryParamNames } =
    buildInputSchema(operation)
  const meta = operation["x-mcp"]
  const annotations = buildAnnotations(method, operation, operationId)
  const hitlPolicy = resolveHitlPolicy(meta, annotations)
  const inputSchema =
    hitlPolicy === "none" || !includeConfirmInput
      ? schema
      : {
          ...schema,
          properties: {
            ...schema.properties,
            _confirm: {
              description:
                "Set to true only after the user has reviewed the proposed action and explicitly confirmed it.",
              type: "boolean",
            },
          },
        }
  return {
    alwaysVisible: meta?.alwaysVisible === true,
    annotations,
    baseUrl,
    bodyParamNames,
    description: buildToolDescription(operation, meta, annotations),
    hitlPolicy,
    inputSchema,
    method: method.toUpperCase(),
    name: toSnakeCase(operationId),
    operationId,
    pathParamNames: extractPathParamNames(pathTemplate),
    pathTemplate,
    queryParamNames,
    scope: meta?.scope,
    tags: operation.tags ?? [],
    visibility: meta?.visibility === "default" ? "default" : "hidden",
  }
}

/**
 * Parses `/api/public-spec.json` into the flat tool list every consumer
 * shares. Pure function: no fetch, no cache — the loader owns those.
 */
export function parseToolsFromSpec(
  spec: OpenAPISpec,
  options: ParseToolsOptions,
): DynamicTool[] {
  const baseUrl =
    options.baseUrlOverride ?? spec.servers?.[0]?.url ?? options.fallbackBaseUrl
  const excluded =
    options.excludeOperationIdPrefixes ?? EXCLUDED_OPERATION_ID_PREFIXES
  const includeConfirmInput = options.includeConfirmInput === true
  const tools: DynamicTool[] = []

  for (const [pathTemplate, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) {
        continue
      }
      if (
        operation.operationId &&
        excluded.some((prefix) => operation.operationId?.startsWith(prefix))
      ) {
        continue
      }

      const tool = parseOperation(
        pathTemplate,
        method,
        operation,
        baseUrl,
        includeConfirmInput,
      )
      if (tool) {
        tools.push(tool)
      }
    }
  }

  return tools
}

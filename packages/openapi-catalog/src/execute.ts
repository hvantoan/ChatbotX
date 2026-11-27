import type { DynamicTool } from "./types"

const NO_BODY_METHODS = new Set(["GET", "HEAD"])

const EMAIL_PATTERN = /^[\w.+-]+@[\w-]+\.[\w.]+$/u
const PHONE_PATTERN = /^\+\d{6,}$/u
const LOCAL_PHONE_PATTERN = /^0\d{8,}$/u
const NUMERIC_ID_PATTERN = /^\d+$/u
const MAX_BARE_ID_LENGTH = 10
const PREFIXED_IDENTIFIER_PATTERN = /^(id|email|phone):/u

/**
 * Contact-facing tools accept a prefixed identifier (`id:123`,
 * `email:ada@example.com`, `phone:+841234567890`). Agents often pass a bare
 * value instead, which the API then rejects with a 404. The shape is
 * unambiguous — an email has an `@`, a phone number starts with `+` or `0`
 * and is otherwise all digits, and a short bare numeric string is an id — so
 * auto-prefixing removes preventable failures without guessing at anything
 * semantically unclear. A value that already carries a recognized prefix, or
 * matches none of the three shapes (e.g. a display name), is passed through
 * unchanged so the API's real validation error still surfaces.
 */
function withNormalizedIdentifier(value: unknown): unknown {
  if (typeof value !== "string") {
    return value
  }
  if (PREFIXED_IDENTIFIER_PATTERN.test(value)) {
    return value
  }
  if (EMAIL_PATTERN.test(value)) {
    return `email:${value}`
  }
  if (PHONE_PATTERN.test(value) || LOCAL_PHONE_PATTERN.test(value)) {
    return `phone:${value}`
  }
  if (NUMERIC_ID_PATTERN.test(value) && value.length < MAX_BARE_ID_LENGTH) {
    return `id:${value}`
  }
  return value
}

/**
 * Applies `withNormalizedIdentifier` to every argument literally named
 * `identifier` — the consistent parameter name every contact-identifier
 * tool uses, in both path params (`contacts.get`) and body fields
 * (`contacts.addTagsByName`). Every other argument passes through
 * untouched; this never rewrites ids, emails, or phone numbers under a
 * different key.
 */
export function normalizeToolArguments(
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!("identifier" in args)) {
    return args
  }
  return {
    ...args,
    identifier: withNormalizedIdentifier(args.identifier),
  }
}

const schemaAllowsNull = (schema: unknown): boolean => {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return false
  }
  const { anyOf, type } = schema as { anyOf?: unknown; type?: unknown }
  return (
    type === "null" ||
    (Array.isArray(anyOf) && anyOf.some((option) => schemaAllowsNull(option)))
  )
}

const applyNullableRequiredDefaults = (
  tool: DynamicTool,
  args: Record<string, unknown>,
): Record<string, unknown> => {
  let normalizedArguments = args
  for (const key of tool.inputSchema.required ?? []) {
    if (
      args[key] === undefined &&
      schemaAllowsNull(tool.inputSchema.properties[key])
    ) {
      if (normalizedArguments === args) {
        normalizedArguments = { ...args }
      }
      normalizedArguments[key] = null
    }
  }
  return normalizedArguments
}

const preflightArgumentError = (
  tool: DynamicTool,
  args: Record<string, unknown>,
): string | undefined => {
  const missing = (tool.inputSchema.required ?? []).filter(
    (key) =>
      args[key] === undefined ||
      (args[key] === null &&
        !schemaAllowsNull(tool.inputSchema.properties[key])),
  )
  if (missing.length === 0) {
    return
  }
  const declaredKeys = new Set(Object.keys(tool.inputSchema.properties))
  const suspectedWrapper = ["body", "params", "input"].find((key) => {
    const value = args[key]
    return (
      !declaredKeys.has(key) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    )
  })
  const missingList = missing.join(", ")
  return suspectedWrapper
    ? `Missing required field(s): ${missingList}. Arguments must be a flat object matching inputSchema — found a "${suspectedWrapper}" wrapper instead of passing its fields at the top level.`
    : `Missing required field(s): ${missingList}. See the tool's inputSchema for the full shape.`
}

const appendQueryParam = (
  params: URLSearchParams,
  key: string,
  value: unknown,
): void => {
  if (value === undefined || value === null) {
    return
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      appendQueryParam(params, `${key}[${index}]`, item)
    }
    return
  }

  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendQueryParam(params, `${key}[${childKey}]`, childValue)
    }
    return
  }

  params.append(key, String(value))
}

export type PreparedExecution =
  | { args: Record<string, unknown>; error?: never }
  | { args?: never; error: string }

/**
 * Applies nullable-default completion, required-field preflight and
 * identifier normalization — everything a caller can check or repair before
 * the network round-trip. A non-null `error` means the arguments never reach
 * the wire.
 */
export function prepareToolExecution(
  tool: DynamicTool,
  rawArgs: Record<string, unknown>,
): PreparedExecution {
  const prepared = applyNullableRequiredDefaults(tool, rawArgs)
  const preflightError = preflightArgumentError(tool, prepared)
  if (preflightError) {
    return { error: preflightError }
  }
  return { args: normalizeToolArguments(prepared) }
}

export type OperationExecutionCredentials = {
  token: string
  workspaceId?: string
}

export type OperationExecutionResult = {
  status: number
  ok: boolean
  contentType: string
  /** Parsed JSON body, or the raw text for non-JSON responses. */
  body: unknown
}

/**
 * The frozen HTTP shape of one catalog operation. `DynamicTool` carries it
 * inline; a Master Agent pending action stores it so the confirm path replays
 * exactly the call the reviewer approved, even after the spec changed.
 */
export type OperationExecutionShape = {
  method: string
  baseUrl: string
  pathTemplate: string
  pathParamNames: string[]
  queryParamNames: string[]
  bodyParamNames: string[]
}

export const executionShapeOf = (
  tool: DynamicTool,
): OperationExecutionShape => ({
  method: tool.method,
  baseUrl: tool.baseUrl,
  pathTemplate: tool.pathTemplate,
  pathParamNames: tool.pathParamNames,
  queryParamNames: tool.queryParamNames,
  bodyParamNames: tool.bodyParamNames,
})

/**
 * Fires the HTTP request an execution shape describes. Deliberately
 * policy-free: confirmation gates, result shaping and error translation
 * belong to the caller (MCP server, worker, builder confirm endpoint), which
 * is exactly why this module can be shared.
 */
export async function executeOperationShape(
  shape: OperationExecutionShape,
  args: Record<string, unknown>,
  credentials: OperationExecutionCredentials,
  httpTimeoutMs: number,
): Promise<OperationExecutionResult> {
  let path = shape.pathTemplate
  for (const paramName of shape.pathParamNames) {
    const value = args[paramName]
    if (value === undefined || value === null) {
      return {
        body: `Missing required path parameter: ${paramName}`,
        contentType: "",
        ok: false,
        status: 0,
      }
    }
    path = path.replace(`{${paramName}}`, encodeURIComponent(String(value)))
  }

  const queryParams = new URLSearchParams()
  for (const key of shape.queryParamNames) {
    appendQueryParam(queryParams, key, args[key])
  }
  const queryString = queryParams.toString()

  const body: Record<string, unknown> = {}
  for (const key of shape.bodyParamNames) {
    if (args[key] !== undefined) {
      body[key] = args[key]
    }
  }

  const url = `${shape.baseUrl}${path}${queryString ? `?${queryString}` : ""}`
  const sendBody =
    !NO_BODY_METHODS.has(shape.method) && shape.bodyParamNames.length > 0

  let response: Response
  try {
    response = await fetch(url, {
      body: sendBody ? JSON.stringify(body) : undefined,
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
        ...(credentials.workspaceId
          ? { "x-workspace-id": credentials.workspaceId }
          : {}),
      },
      method: shape.method,
      signal: AbortSignal.timeout(httpTimeoutMs),
    })
  } catch (error) {
    // `AbortSignal.timeout` rejects with a bare "Timed out" DOMException;
    // callers surface the duration so a model (or a human) can tell a slow
    // API from a networking failure.
    if (error instanceof Error && error.name === "TimeoutError") {
      const timeoutError = new Error(
        `Request timed out after ${httpTimeoutMs}ms`,
      )
      timeoutError.name = "TimeoutError"
      throw timeoutError
    }
    throw error
  }

  const contentType = response.headers.get("content-type") ?? ""
  const parsedBody = contentType.includes("application/json")
    ? await response.json()
    : await response.text()

  return {
    body: parsedBody,
    contentType,
    ok: response.ok,
    status: response.status,
  }
}

/** `executeOperationShape` for a live catalog tool. */
export async function executeOperation(
  tool: DynamicTool,
  args: Record<string, unknown>,
  credentials: OperationExecutionCredentials,
  httpTimeoutMs: number,
): Promise<OperationExecutionResult> {
  return await executeOperationShape(
    executionShapeOf(tool),
    args,
    credentials,
    httpTimeoutMs,
  )
}

/**
 * Finds the GET operation that reads the same resource a mutating tool acts
 * on: the longest path-prefix ancestor with a GET whose path params are a
 * subset of the mutating tool's. Used to snapshot the current state a reviewer
 * (human or model) compares a proposal against. `undefined` means there is no
 * read operation to snapshot with.
 */
export function findCurrentStateTool(
  tool: DynamicTool,
  allTools: readonly DynamicTool[],
): DynamicTool | undefined {
  const getToolsByPath = new Map(
    allTools
      .filter((candidate) => candidate.method === "GET")
      .map((candidate) => [candidate.pathTemplate, candidate]),
  )
  const pathSegments = tool.pathTemplate.split("/")
  for (
    let segmentCount = pathSegments.length;
    segmentCount > 1;
    segmentCount -= 1
  ) {
    const candidate = getToolsByPath.get(
      pathSegments.slice(0, segmentCount).join("/"),
    )
    if (
      candidate &&
      candidate.pathParamNames.length > 0 &&
      candidate.pathParamNames.every((name) =>
        tool.pathParamNames.includes(name),
      )
    ) {
      return candidate
    }
  }
  return
}

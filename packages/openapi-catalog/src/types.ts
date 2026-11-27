/**
 * Shared types for the public OpenAPI catalog: the shape of
 * `/api/public-spec.json` as the loaders consume it, and the `DynamicTool`
 * projection every caller (MCP server, CLI, worker) drives its surface from.
 * Dependency-free so every consumer can import it.
 */

export interface OpenAPISpec {
  paths?: Record<string, Record<string, OpenAPIOperation>>
  servers?: Array<{ url: string }>
}

export type McpHitlPolicy =
  | "none"
  | "confirm_diff"
  | "confirm_destructive"
  | "confirm_outbound"

export interface McpOperationMeta {
  alwaysVisible?: boolean
  destructiveHint?: boolean
  hitlPolicy?: McpHitlPolicy
  idempotentHint?: boolean
  openWorldHint?: boolean
  readOnlyHint?: boolean
  scope?: string | string[]
  visibility?: "default" | "hidden"
}

export interface OpenAPIOperation {
  deprecated?: boolean
  description?: string
  operationId?: string
  parameters?: OpenAPIParameter[]
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: OpenAPISchemaObject
      }
    }
  }
  security?: Record<string, string[]>[]
  summary?: string
  tags?: string[]
  "x-mcp"?: McpOperationMeta
}

export interface OpenAPIParameter {
  description?: string
  in: "path" | "query" | "header" | "cookie"
  name: string
  required?: boolean
  schema?: OpenAPISchemaObject
}

export interface OpenAPISchemaObject {
  allOf?: OpenAPISchemaObject[]
  anyOf?: OpenAPISchemaObject[]
  default?: unknown
  description?: string
  enum?: unknown[]
  format?: string
  items?: OpenAPISchemaObject
  nullable?: boolean
  oneOf?: OpenAPISchemaObject[]
  properties?: Record<string, OpenAPISchemaObject>
  required?: string[]
  type?: string
}

// Workspace-token security schemes only — a channel-token op (or any scheme
// this list doesn't know about) is deliberately excluded so a token type the
// client doesn't hold never becomes a tool that always 401s.
const WORKSPACE_TOKEN_SECURITY_SCHEMES = new Set([
  "bearerAuth",
  "developerAccessToken",
  "tokenInSearchParams",
])

/**
 * `undefined` security means the document-level default applies (workspace
 * token, in this API) — true. An explicit `security` array is true only if
 * at least one alternative names a workspace-token scheme; `[]` (no auth) or
 * an array of non-workspace schemes (e.g. `channelApiToken`) is false.
 */
export function isWorkspaceTokenOperation(
  operation: OpenAPIOperation,
): boolean {
  if (!operation.security) {
    return true
  }

  return operation.security.some((requirement) =>
    Object.keys(requirement).some((scheme) =>
      WORKSPACE_TOKEN_SECURITY_SCHEMES.has(scheme),
    ),
  )
}

export interface DynamicToolAnnotations {
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
  readOnlyHint: boolean
  title: string
}

export interface DynamicTool {
  alwaysVisible: boolean
  annotations: DynamicToolAnnotations
  baseUrl: string
  bodyParamNames: string[]
  description: string
  hitlPolicy: McpHitlPolicy
  inputSchema: {
    type: "object"
    properties: Record<string, unknown>
    required?: string[]
  }
  method: string
  name: string
  /** Raw spec operationId (e.g. `broadcasts.schedule`). */
  operationId: string
  pathParamNames: string[]
  pathTemplate: string
  queryParamNames: string[]
  scope?: string | string[]
  tags: string[]
  visibility: "default" | "hidden"
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z]{2,})(?=[A-Z][a-z]|$)/g, "_$1")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[.\-\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

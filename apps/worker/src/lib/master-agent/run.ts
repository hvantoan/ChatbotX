import {
  masterAgentService,
  mintMasterAgentCredential,
} from "@inboxos.io/business"
import {
  type DynamicTool,
  distinctResourceGroups,
  executeOperation,
  executionShapeOf,
  findCurrentStateTool,
  getGuide,
  isGuideName,
  prepareToolExecution,
  rankTools,
} from "@inboxos.io/openapi-catalog"
import { env } from "../../env"
import { logger } from "../logger"
import {
  findCatalogToolByName,
  getMasterAgentCatalogTools,
  loadMasterAgentCatalog,
} from "./catalog"

/**
 * The identities a catalog call can end in. `ok` carries the API's JSON
 * response body back to the model; `pending` means nothing was executed and a
 * human must approve the stored action first; `error` is any failure the
 * model should see and correct (validation, unknown tool, API rejection).
 */
export type CatalogCallOutcome =
  | { kind: "ok"; body: unknown }
  | { kind: "pending"; actionId: string; operationId: string }
  | { kind: "error"; message: string }

export type MasterAgentTurnContext = {
  workspaceId: string
  sessionId: string
  messageId: string
  memberId: string | null
  tokenId: string | null
  autoApproveDiff: boolean
}

const MAX_SEARCH_RESULTS = 10

const mintCredential = async (
  context: MasterAgentTurnContext,
): Promise<string> => {
  const secret = env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set on the worker — the Master Agent cannot authenticate against the public API",
    )
  }
  return await mintMasterAgentCredential({
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    ...(context.memberId ? { memberId: context.memberId } : {}),
    ...(context.tokenId ? { tokenId: context.tokenId } : {}),
    secret,
  })
}

/**
 * Snapshots the resource the mutation acts on for the reviewer's diff. Best
 * effort: the pending action is still recorded when the read fails (the
 * reviewer sees "current state unavailable"), never the other way round.
 */
const captureCurrentState = async (
  tool: DynamicTool,
  args: Record<string, unknown>,
  token: string,
): Promise<unknown> => {
  const stateTool = findCurrentStateTool(tool, getMasterAgentCatalogTools())
  if (!stateTool) {
    return null
  }
  try {
    const stateArgs = Object.fromEntries(
      stateTool.pathParamNames.map((name) => [name, args[name]]),
    )
    const result = await executeOperation(
      stateTool,
      stateArgs,
      { token },
      15_000,
    )
    if (!(result.ok && result.contentType.includes("application/json"))) {
      return null
    }
    return result.body
  } catch (error) {
    logger.warn(
      { err: error, operationId: tool.operationId },
      "[master-agent] current-state capture failed",
    )
    return null
  }
}

const CONFIRM_ARG = "_confirm"

/**
 * Executes one `call_tool` invocation against the public API, enforcing the
 * operation's hitl policy server-side. The model's `_confirm` input is
 * stripped unread — confirmation is a human decision made in the UI, never
 * something the agent can supply itself.
 */
export const runCatalogTool = async (
  context: MasterAgentTurnContext,
  toolName: string,
  rawArgs: Record<string, unknown>,
): Promise<CatalogCallOutcome> => {
  await loadMasterAgentCatalog()
  const tool = findCatalogToolByName(toolName)
  if (!tool) {
    return {
      kind: "error",
      message: `Unknown tool: ${toolName}. Use search_tools to find the exact name.`,
    }
  }

  // Strip the hitl-gate argument before anything else sees the arguments.
  const args = { ...rawArgs }
  delete args[CONFIRM_ARG]

  const prepared = prepareToolExecution(tool, args)
  if (prepared.error !== undefined) {
    return { kind: "error", message: prepared.error }
  }
  const preparedArgs = prepared.args ?? {}

  let token: string
  try {
    token = await mintCredential(context)
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : "Credential error",
    }
  }
  const credentials = { token }

  const policy = tool.hitlPolicy
  const needsApproval =
    policy === "confirm_outbound" ||
    policy === "confirm_destructive" ||
    (policy === "confirm_diff" && !context.autoApproveDiff)

  if (!needsApproval) {
    try {
      const result = await executeOperation(
        tool,
        preparedArgs,
        credentials,
        30_000,
      )
      if (!result.ok) {
        return {
          kind: "error",
          message: `Error ${result.status}: ${JSON.stringify(result.body)}`,
        }
      }
      return { kind: "ok", body: result.body }
    } catch (error) {
      return {
        kind: "error",
        message: `Request failed: ${error instanceof Error ? error.message : "unknown error"}`,
      }
    }
  }

  const currentState = await captureCurrentState(tool, preparedArgs, token)
  const action = await masterAgentService.createPendingAction({
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    messageId: context.messageId,
    operationId: tool.operationId,
    args: preparedArgs,
    policy,
    currentState,
    execution: {
      ...executionShapeOf(tool),
      toolName: tool.name,
    },
  })
  return {
    kind: "pending",
    actionId: action.id,
    operationId: tool.operationId,
  }
}

export type SearchToolsResult = {
  matches: Array<{ name: string; description: string }>
  totalMatches: number
  resourceGroups: string[]
}

export const searchCatalogTools = async (
  query: string,
): Promise<SearchToolsResult> => {
  const catalog = await loadMasterAgentCatalog()
  const matches = rankTools(catalog, query, MAX_SEARCH_RESULTS)
  return {
    matches: matches.map((tool) => ({
      name: tool.name,
      description: tool.description || tool.annotations.title,
    })),
    totalMatches: matches.length,
    resourceGroups: distinctResourceGroups(catalog),
  }
}

export type InspectCatalogToolResult =
  | {
      name: string
      operationId: string
      description: string
      method: string
      pathTemplate: string
      hitlPolicy: DynamicTool["hitlPolicy"]
      inputSchema: DynamicTool["inputSchema"]
    }
  | { error: string }

/**
 * Exact-name schema lookup. Search results stay compact; the agent calls this
 * before `call_tool` so nested fields, valid values and optional parameters
 * are never guessed.
 */
export const inspectCatalogTool = async (
  name: string,
): Promise<InspectCatalogToolResult> => {
  await loadMasterAgentCatalog()
  const tool = findCatalogToolByName(name)
  if (!tool) {
    return {
      error: `Unknown tool: ${name}. Use search_tools to find the exact name.`,
    }
  }
  return {
    name: tool.name,
    operationId: tool.operationId,
    description: tool.description,
    method: tool.method,
    pathTemplate: tool.pathTemplate,
    hitlPolicy: tool.hitlPolicy,
    inputSchema: tool.inputSchema,
  }
}

export const readGuide = (
  name: string,
): { content: string } | { error: string } => {
  if (!isGuideName(name)) {
    return {
      error: `Unknown guide: ${name}. Valid guides: contacts-and-pipelines, flows-and-automation, inbox-and-handover, overview`,
    }
  }
  return { content: getGuide(name).content }
}

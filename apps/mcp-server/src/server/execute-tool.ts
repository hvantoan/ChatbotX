import {
  executeOperation,
  findCurrentStateTool,
  prepareToolExecution,
} from "@inboxos.io/openapi-catalog"
import { env } from "../env"
import { type DynamicTool, getCachedTools } from "../openapi-loader"
import { enforceHitlGate } from "./hitl-gate"

export { normalizeToolArguments } from "@inboxos.io/openapi-catalog"

const TRAILING_COLON_PATTERN = /:$/u

export type RequestCredentials = {
  token: string
  workspaceId?: string
}

export type ToolCallResult = {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

export const errorResult = (text: string): ToolCallResult => ({
  content: [{ text, type: "text" }],
  isError: true,
})

export const jsonResult = (value: unknown): ToolCallResult => ({
  content: [{ text: JSON.stringify(value, null, 2), type: "text" }],
})

const firstLine = (value: string): string =>
  value.split("\n")[0]?.replace(TRAILING_COLON_PATTERN, "") ?? "unknown failure"

const getCurrentState = async (props: {
  args: Record<string, unknown>
  credentials: RequestCredentials
  tool: DynamicTool
}): Promise<{ state: unknown } | { unavailable: string }> => {
  const stateTool = findCurrentStateTool(props.tool, getCachedTools())
  if (!stateTool) {
    return { unavailable: "no read operation" }
  }

  const stateArgs = Object.fromEntries(
    stateTool.pathParamNames.map((name) => [name, props.args[name]]),
  )
  const stateResult = await executeOperation(
    stateTool,
    stateArgs,
    props.credentials,
    env.INBOXOS_HTTP_TIMEOUT_MS,
  )
  if (!stateResult.ok) {
    // Same shape the recursive `executeTool` error path produced: the first
    // line is `Error <status>` and carries into the confirmation payload.
    return {
      unavailable: firstLine(
        `Error ${stateResult.status}:\n${typeof stateResult.body === "string" ? stateResult.body : JSON.stringify(stateResult.body)}`,
      ),
    }
  }
  if (!stateResult.contentType.includes("application/json")) {
    return { unavailable: "non-JSON body" }
  }

  return { state: stateResult.body }
}

/**
 * Fires the HTTP request a `DynamicTool` describes, behind the MCP server's
 * hitl gate. Shared by the normal `tools/call` path (`create-mcp-server.ts`)
 * and `call_tool` (`meta-tools.ts`) — the latter looks a tool up outside
 * `tools/list`'s `visibility: "default"` filter, but execution is identical
 * either way.
 */
export async function executeTool(
  tool: DynamicTool,
  rawArgs: Record<string, unknown>,
  credentials: RequestCredentials,
): Promise<ToolCallResult> {
  const prepared = prepareToolExecution(tool, rawArgs)
  if (prepared.error) {
    return errorResult(prepared.error)
  }

  let args = prepared.args as Record<string, unknown>
  try {
    const hitlGate = await enforceHitlGate({
      args,
      getCurrentState: async () =>
        await getCurrentState({
          args,
          credentials,
          tool,
        }),
      tool,
    })
    if (hitlGate.failure) {
      return errorResult(JSON.stringify(hitlGate.failure, null, 2))
    }
    if (!hitlGate.args) {
      return errorResult("Confirmation failed: gate returned no arguments")
    }
    args = hitlGate.args
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown confirmation error"
    return errorResult(`Confirmation failed: ${message}`)
  }

  try {
    const result = await executeOperation(
      tool,
      args,
      credentials,
      env.INBOXOS_HTTP_TIMEOUT_MS,
    )

    if (!result.ok) {
      return errorResult(
        `Error ${result.status}:\n${JSON.stringify(result.body, null, 2)}`,
      )
    }

    return jsonResult(result.body)
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return errorResult(error.message)
    }
    const message = error instanceof Error ? error.message : "Unknown error"
    return errorResult(`Request failed: ${message}`)
  }
}

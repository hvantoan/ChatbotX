import { aiTimeouts } from "@inboxos.io/ai"
import {
  MASTER_AGENT_DEFAULT_PROMPT,
  MASTER_AGENT_TIMEZONE,
  masterAgentService,
} from "@inboxos.io/business"
import type { AIAgentProviderModels } from "@inboxos.io/database/partials"
import type { AIJobProcessMasterAgent } from "@inboxos.io/worker-config"
import { generateText, isStepCount, type ModelMessage, tool } from "ai"
import { normalizeError } from "universal-error-normalizer"
import { z } from "zod"
import { createReplyModel, getProviderName } from "../../lib/ai/reply-model"
import { logger } from "../../lib/logger"
import {
  inspectCatalogTool,
  type MasterAgentTurnContext,
  readGuide,
  runCatalogTool,
  searchCatalogTools,
} from "../../lib/master-agent/run"

/**
 * Discovery plus several mutations can chain inside one request — a Zoom
 * summary turn typically searches, reads one guide, drafts, then schedules.
 * Twelve steps leaves slack for two mistakes before the ceiling truncates it.
 */
const MASTER_AGENT_MAX_STEPS = 12

const TURN_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: MASTER_AGENT_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/**
 * The turn's system prompt: the shared behavior contract, the wall-clock time
 * the workspace's operators read everything in, and whatever extra behavior
 * the workspace configured.
 */
const buildInstructions = (props: {
  configPrompt: string | null
  now: Date
}): string => {
  const parts = [
    `Current time: ${TURN_TIME_FORMATTER.format(props.now)} (${MASTER_AGENT_TIMEZONE}).`,
    MASTER_AGENT_DEFAULT_PROMPT,
  ]
  if (props.configPrompt?.trim()) {
    parts.push(props.configPrompt)
  }
  return parts.join("\n\n")
}

/**
 * The meta-tools are the whole toolbox: the catalog behind them is the
 * workspace's public API, so the agent can do everything the API can do
 * without hundreds of per-resource tool definitions. Policy enforcement
 * (confirm/approve) lives inside `runCatalogTool`, never in the model.
 */
const buildMetaTools = (context: MasterAgentTurnContext) => ({
  search_tools: tool({
    description:
      "Search the workspace's API catalog for the operation you need. Use one action plus one resource in the query (e.g. 'create broadcast', 'update contact'). Returns the exact tool names to pass to call_tool.",
    inputSchema: z.object({
      query: z.string().describe("The capability you are looking for"),
    }),
    execute: async ({ query }) => await searchCatalogTools(query),
  }),
  inspect_tool: tool({
    description:
      "Inspect one catalog operation by the exact name search_tools returned. Always use this before call_tool when the operation has arguments: it returns the full inputSchema, usage description, HTTP method/path and approval policy.",
    inputSchema: z.object({
      name: z.string().describe("Exact tool name returned by search_tools"),
    }),
    execute: async ({ name }) => await inspectCatalogTool(name),
  }),
  call_tool: tool({
    description:
      "Execute an operation from the catalog by the exact name search_tools returned. Arguments must match the inputSchema returned by inspect_tool. Some actions need human approval: when the result says the action is pending, report that to the user and stop — do not retry the same operation in this turn.",
    inputSchema: z.object({
      name: z.string().describe("Exact tool name returned by search_tools"),
      arguments: z
        .record(z.string(), z.unknown())
        .describe("Flat arguments object matching the operation's inputSchema"),
    }),
    execute: async ({ name, arguments: args }) => {
      const outcome = await runCatalogTool(context, name, args ?? {})
      if (outcome.kind === "pending") {
        return {
          status: "pending_approval",
          actionId: outcome.actionId,
          message: `The operation ${outcome.operationId} needs human approval and has NOT been executed. The user can review and confirm it in the chat. Do not call this operation again in this turn.`,
        }
      }
      if (outcome.kind === "error") {
        return { error: outcome.message }
      }
      return outcome.body
    },
  }),
  get_guide: tool({
    description:
      "Read the operational guide for a resource group before your first mutation on it: contacts-and-pipelines, flows-and-automation, inbox-and-handover, or overview.",
    inputSchema: z.object({
      name: z.string().describe("Guide name"),
    }),
    execute: async ({ name }) => readGuide(name),
  }),
})

/**
 * Runs one Master Agent turn: the chat's own history is the prompt and the
 * catalog meta-tools the only actions it can take. Every write the agent
 * performs goes through the public API over HTTP with a short-lived internal
 * credential — this file never touches the database for anything but the
 * turn's own message rows. The reply is written back into the pending
 * assistant row, so the session read returns it without a second history
 * record.
 */
export async function processMasterAgent(
  data: AIJobProcessMasterAgent["data"],
): Promise<void> {
  const { workspaceId, sessionId, messageId } = data

  try {
    const session = await masterAgentService.getSession({
      workspaceId,
      sessionId,
      // The job carries no viewer: it runs the turn it was handed.
      asSystem: true,
    })

    const config = await masterAgentService.getConfig({ workspaceId })
    const models = (config?.models ?? []) as unknown as AIAgentProviderModels
    if (!(config?.enabled && models.length > 0)) {
      await masterAgentService.completeTurn({
        workspaceId,
        messageId,
        content: "",
        status: "failed",
      })
      logger.warn(
        { workspaceId, sessionId },
        "[master-agent] agent not configured or disabled; turn failed",
      )
      return
    }

    // History stops at this turn's own row: a follow-up sent while this job was
    // queued must not be answered by it (and must not be answered twice when
    // its own job runs).
    const turnIndex = session.messages.findIndex(
      (message) => message.id === messageId,
    )
    const history =
      turnIndex === -1 ? session.messages : session.messages.slice(0, turnIndex)
    const messages: ModelMessage[] = history
      .filter((message) => message.status === "completed")
      .map((message) => ({
        role: message.role,
        content: message.content,
      }))

    const turnContext: MasterAgentTurnContext = {
      workspaceId,
      sessionId,
      messageId,
      memberId: data.memberId ?? null,
      tokenId: data.tokenId ?? null,
      autoApproveDiff: config.autoApproveDiff,
    }

    const instructions = buildInstructions({
      configPrompt: config.prompt,
      now: new Date(),
    })
    const tools = buildMetaTools(turnContext)

    let replyText: string | null = null
    for (const providerInfo of models) {
      // The turn is operator-initiated, so the workspace's "AI Auto Reply"
      // switch (which gates automated customer replies) must not silence it.
      const modelConfig = await createReplyModel({
        workspaceId,
        providerInfo,
        requireAutoReply: false,
      })
      if (!modelConfig) {
        continue
      }
      try {
        const result = await generateText({
          model: modelConfig.model,
          instructions,
          messages,
          tools,
          stopWhen: isStepCount(MASTER_AGENT_MAX_STEPS),
          abortSignal: AbortSignal.timeout(aiTimeouts.aiTotal),
        })
        replyText = result.text.trim()
        break
      } catch (error) {
        logger.warn(
          {
            err: normalizeError(error),
            workspaceId,
            sessionId,
            provider: getProviderName(providerInfo),
          },
          "[master-agent] provider failed, trying the next one",
        )
      }
    }

    await masterAgentService.completeTurn({
      workspaceId,
      messageId,
      content: replyText ?? "",
      status: replyText ? "completed" : "failed",
    })
  } catch (error) {
    // Mark the turn before the job retries: a client polling the session sees
    // `failed` instead of `pending` forever if every attempt dies here.
    await masterAgentService.completeTurn({
      workspaceId,
      messageId,
      content: "",
      status: "failed",
    })
    throw error
  }
}

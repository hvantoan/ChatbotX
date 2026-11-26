import { aiTimeouts } from "@chatbotx.io/ai"
import { getMasterAgentTools } from "@chatbotx.io/ai/server"
import {
  MASTER_AGENT_DEFAULT_PROMPT,
  masterAgentService,
} from "@chatbotx.io/business"
import type { AIAgentProviderModels } from "@chatbotx.io/database/partials"
import type { AIJobProcessMasterAgent } from "@chatbotx.io/worker-config"
import { generateText, isStepCount, type ModelMessage } from "ai"
import { normalizeError } from "universal-error-normalizer"
import { createReplyModel, getProviderName } from "../../lib/ai/reply-model"
import { logger } from "../../lib/logger"

/** A turn may call a tool, read the result, then answer — five steps is slack. */
const MASTER_AGENT_MAX_STEPS = 5

/**
 * Runs one Master Agent turn: the chat's own history is the prompt, the agent
 * is the workspace's non-default agent (never the one answering customers),
 * and the five reminder tools are the only actions it can take. The reply is
 * written back into the pending assistant row, so the session read returns it
 * without a second history record.
 */
export async function processMasterAgent(
  data: AIJobProcessMasterAgent["data"],
): Promise<void> {
  const { workspaceId, sessionId, messageId } = data

  try {
    const session = await masterAgentService.getSession({
      workspaceId,
      sessionId,
    })

    const agent = await masterAgentService.resolveAgent(workspaceId)
    if (!agent) {
      await masterAgentService.completeTurn({
        workspaceId,
        messageId,
        content: "",
        status: "failed",
      })
      logger.warn(
        { workspaceId, sessionId },
        "[master-agent] no non-default agent configured; turn failed",
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

    const instructions = agent.prompt?.trim()
      ? `${agent.prompt}\n\n${MASTER_AGENT_DEFAULT_PROMPT}`
      : MASTER_AGENT_DEFAULT_PROMPT
    const tools = getMasterAgentTools({ workspaceId, sessionId, messageId })

    let replyText: string | null = null
    const providers = agent.models as AIAgentProviderModels
    for (const providerInfo of providers) {
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

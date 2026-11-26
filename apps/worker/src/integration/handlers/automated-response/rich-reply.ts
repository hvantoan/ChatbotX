import { processStreamingText } from "@inboxos.io/ai"
import { aiContextService } from "@inboxos.io/ai/server"
import type { SalesPromptProduct } from "@inboxos.io/business"
import type {
  AIAgentSalesProfile,
  ConversationSalesState,
} from "@inboxos.io/database/partials"
import { emit } from "@inboxos.io/event-bus"
import { createId } from "@inboxos.io/utils"
import type { LanguageModel } from "ai"
import { normalizeError } from "universal-error-normalizer"
import { logger } from "../../../lib/logger"
import { sendMessageAndWait } from "../../utils/message"
import { parseRichResponse } from "../rich-response"
import { executeRichActions } from "../rich-response/action-executor"
import { sendRichMessages } from "../rich-response/message-sender"
import type {
  ReplyAIProvider,
  ReplyByAIExecutionResult,
  ReplyByAIProps,
} from "./replies"
import {
  evaluateSalesGuard,
  extractRichResponseTexts,
  resolveSalesHandoffMessage,
} from "./sales-guard"
import { buildTrackingContext } from "./tracking-context"

type DirectSendTracker = {
  sent: boolean
  sentText: string
}

export type RichReplySalesGuardContext = {
  profile: AIAgentSalesProfile
  products: SalesPromptProduct[]
  salesState: ConversationSalesState
  model: LanguageModel
  systemPrompt: string
  handoffTracker?: { executed: boolean }
}

type HandleRichAIReplyOptions = {
  buildToolStats: () => ReplyByAIExecutionResult["toolStats"]
  directSendTracker: DirectSendTracker
  modelId: string
  props: ReplyByAIProps
  provider: ReplyAIProvider
  startTime: number
  textStream: AsyncIterable<string>
  salesGuardContext?: RichReplySalesGuardContext
}

export async function handleRichAIReply({
  buildToolStats,
  directSendTracker,
  modelId,
  props,
  provider,
  startTime,
  textStream,
  salesGuardContext,
}: HandleRichAIReplyOptions): Promise<null | ReplyByAIExecutionResult> {
  const { conversation } = props
  const { fullText } = await processStreamingText(
    textStream,
    async () => {
      // Rich mode buffers the whole response, so partial text is ignored.
    },
    { sendParts: false },
  ).catch(async (streamError) => {
    const normalizedError = normalizeError(streamError)
    logger.error(
      {
        provider,
        modelId,
        conversationId: conversation.id,
        err: normalizedError,
      },
      "[automated-response] processStreamingText threw error",
    )
    await emitStreamFailureAnalytics({
      channel: props.contactInbox.channel,
      inboxId: props.contactInbox.inboxId,
      conversationId: conversation.id,
      messageId: props.triggerMessageId,
      modelId,
      provider,
      startTime,
      workspaceId: conversation.workspaceId,
    })
    return { messageCount: 0, fullText: "" }
  })

  if (directSendTracker.sent) {
    if (directSendTracker.sentText) {
      await appendAssistantHistory(conversation.id, directSendTracker.sentText)
    }
    return buildSuccessResult({ buildToolStats, modelId, provider })
  }

  const executionId = props.triggerMessageId as string
  const trackingContext = buildTrackingContext({
    conversationId: conversation.id,
    messageId: executionId,
    provider,
    responseType: "ai_agent",
    startTime,
    triggerType: props.trackingTriggerType ?? "rich_response",
    workspaceId: conversation.workspaceId,
  })

  const parseResult = parseRichResponse(fullText)

  // The `connectUserToHuman` tool already handed off but the model left no
  // text the guard could check: send the waiting message here, otherwise the
  // caller would treat this as a failure and let the next provider reply.
  const sendToolHandoffWaitingMessage = async () => {
    if (!salesGuardContext) {
      return null
    }
    const text = resolveSalesHandoffMessage(salesGuardContext.profile)
    await sendMessageAndWait(conversation.id, text, trackingContext)
    await appendAssistantHistory(conversation.id, text)
    return buildSuccessResult({ buildToolStats, modelId, provider })
  }
  const toolHandoffExecuted = Boolean(
    salesGuardContext?.handoffTracker?.executed,
  )
  if (!parseResult.ok) {
    logger.warn(
      {
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        reason: parseResult.reason,
      },
      "[rich-response] invalid AI rich response",
    )

    if (parseResult.reason === "plain_text" && parseResult.text.trim()) {
      const trimmedText = parseResult.text.trim()
      if (salesGuardContext) {
        const sendRichGuardReply = async (text: string) => {
          // evaluateSalesGuard emits the single `message:bot_received` analytics event.
          await sendMessageAndWait(conversation.id, text)
          await appendAssistantHistory(conversation.id, text)
        }
        const guardResult = await evaluateSalesGuard({
          conversation,
          contactInbox: props.contactInbox,
          aiAgent: props.aiAgent,
          profile: salesGuardContext.profile,
          products: salesGuardContext.products,
          salesState: salesGuardContext.salesState,
          model: salesGuardContext.model,
          modelId,
          provider,
          systemPrompt: salesGuardContext.systemPrompt,
          messages: props.messages,
          candidateText: trimmedText,
          triggerMessageId: props.triggerMessageId,
          channel: props.channel,
          startTime,
          handoffTracker: salesGuardContext.handoffTracker,
          sendHandoffMessage: sendRichGuardReply,
        })
        if (guardResult.outcome !== "handoff" && guardResult.finalText) {
          await sendRichGuardReply(guardResult.finalText)
        }
        return buildSuccessResult({ buildToolStats, modelId, provider })
      }
      await sendMessageAndWait(conversation.id, trimmedText, trackingContext)
      await appendAssistantHistory(conversation.id, trimmedText)
      return buildSuccessResult({ buildToolStats, modelId, provider })
    }

    if (toolHandoffExecuted) {
      return sendToolHandoffWaitingMessage()
    }
    return null
  }

  const richResponse = parseResult.data
  let salesGuardEmittedAnalytics = false
  if (salesGuardContext) {
    const extractedText = extractRichResponseTexts(richResponse).trim()
    if (!extractedText && toolHandoffExecuted) {
      return sendToolHandoffWaitingMessage()
    }
    if (extractedText) {
      const sendRichGuardReply = async (text: string) => {
        // evaluateSalesGuard emits the single `message:bot_received` analytics event.
        await sendMessageAndWait(conversation.id, text)
        await appendAssistantHistory(conversation.id, text)
      }
      const guardResult = await evaluateSalesGuard({
        conversation,
        contactInbox: props.contactInbox,
        aiAgent: props.aiAgent,
        profile: salesGuardContext.profile,
        products: salesGuardContext.products,
        salesState: salesGuardContext.salesState,
        model: salesGuardContext.model,
        modelId,
        provider,
        systemPrompt: salesGuardContext.systemPrompt,
        messages: props.messages,
        candidateText: extractedText,
        triggerMessageId: props.triggerMessageId,
        channel: props.channel,
        startTime,
        handoffTracker: salesGuardContext.handoffTracker,
        sendHandoffMessage: sendRichGuardReply,
      })
      salesGuardEmittedAnalytics = true
      if (guardResult.outcome === "handoff") {
        return buildSuccessResult({ buildToolStats, modelId, provider })
      }
      if (
        (guardResult.outcome === "rewritten" ||
          guardResult.outcome === "fallback") &&
        guardResult.finalText
      ) {
        await sendRichGuardReply(guardResult.finalText)
        return buildSuccessResult({ buildToolStats, modelId, provider })
      }
    }
  }
  const flowContextId = createId()
  const context = {
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    contactId: conversation.contactId,
    contactInboxId: props.contactInbox.id,
    inboxId: props.contactInbox.inboxId,
    channel: props.channel,
    executionId,
    flowContextId,
  }

  const messageResult =
    richResponse.messages.length > 0
      ? await sendRichMessages(
          richResponse.messages,
          context,
          // The guard already emitted the single bot_received event for this
          // trigger message; sending with tracking would emit a second one.
          salesGuardEmittedAnalytics ? undefined : trackingContext,
        )
      : { enqueued: 0, skipped: 0 }
  const actionResult = await executeRichActions(richResponse.actions, context)
  const hasSentMessages = messageResult.enqueued > 0
  const hasExecutedAction = actionResult.executed > 0

  if (!(hasSentMessages || hasExecutedAction)) {
    logger.warn(
      {
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        executionId,
        failedActions: actionResult.failed,
        messageResult,
      },
      "[rich-response] action-only response failed without sending messages",
    )
    return null
  }

  if (!hasSentMessages) {
    await emit("analytics:dashboard", {
      eventType: "message:bot_received",
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      channel: props.contactInbox.channel,
      inboxId: props.contactInbox.inboxId,
      messageId: executionId,
      occurredAt: new Date(),
      hasResponse: true,
      responseType: "ai_agent",
      routeType: "agent",
      result: "success",
      aiProvider: provider,
      metadata: {
        latency: Date.now() - startTime,
        modelId,
        richMode: true,
        actionResult,
        triggerContext: {
          triggerSource: "worker",
          triggerHandler: "replyByAI",
          triggerType: props.trackingTriggerType ?? "rich_response_action_only",
        },
      },
    })
  }

  await appendAssistantHistory(conversation.id, fullText)

  return buildSuccessResult({ buildToolStats, modelId, provider })
}

async function appendAssistantHistory(
  conversationId: string,
  content: string,
): Promise<void> {
  await aiContextService.appendHistory({
    conversationId,
    newMessages: [
      {
        message: { role: "assistant", content },
        createdAt: Date.now(),
      },
    ],
  })
}

async function emitStreamFailureAnalytics(input: {
  channel: string
  conversationId: string
  inboxId: string
  messageId?: string
  modelId: string
  provider: ReplyAIProvider
  startTime: number
  workspaceId: string
}): Promise<void> {
  if (!input.messageId) {
    return
  }

  await emit("analytics:dashboard", {
    eventType: "message:bot_received",
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    channel: input.channel,
    inboxId: input.inboxId,
    messageId: input.messageId,
    occurredAt: new Date(),
    hasResponse: false,
    responseType: "ai_agent",
    routeType: "agent",
    result: "fallback",
    aiProvider: input.provider,
    metadata: {
      latency: Date.now() - input.startTime,
      fallbackReason: "ai_stream_error",
      modelId: input.modelId,
      richMode: true,
      triggerContext: {
        triggerSource: "worker",
        triggerHandler: "replyByAI",
        triggerType: "rich_response_stream_failed",
      },
    },
  })
}

function buildSuccessResult(input: {
  buildToolStats: () => ReplyByAIExecutionResult["toolStats"]
  modelId: string
  provider: ReplyAIProvider
}): ReplyByAIExecutionResult {
  return {
    responded: true,
    provider: input.provider,
    modelId: input.modelId,
    usedFallbackText: false,
    toolStats: input.buildToolStats(),
  }
}

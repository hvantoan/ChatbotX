import {
  type AIProviderInstance,
  createAIProviderInstance,
  createOpenaiCompatibleModelInstance,
  getAIIntegrationInDB,
} from "@inboxos.io/ai/server"
import { integrationOpenaiCompatibleService } from "@inboxos.io/business"
import type {
  AIAgentModelConfig,
  AIAgentOpenaiCompatibleProviderModel,
  AIAgentProvider,
} from "@inboxos.io/database/partials"
import type { LanguageModel } from "ai"
import { logger } from "../logger"

export type ReplyAIProvider = AIAgentProvider | "openaiCompatible"

export function isOpenaiCompatibleProviderModel(
  providerInfo: AIAgentModelConfig,
): providerInfo is AIAgentOpenaiCompatibleProviderModel {
  return "kind" in providerInfo && providerInfo.kind === "openaiCompatible"
}

export function getProviderName(
  providerInfo: AIAgentModelConfig,
): ReplyAIProvider {
  return isOpenaiCompatibleProviderModel(providerInfo)
    ? "openaiCompatible"
    : providerInfo.provider
}

export async function createReplyModel(props: {
  providerInfo: AIAgentModelConfig
  workspaceId: string
  /**
   * Whether the integration's "AI Auto Reply" switch must be on. Automated
   * customer replies need it; an operator-initiated turn (Master Agent) does
   * not — that switch governs unattended replies, not a model call the
   * workspace member asked for.
   */
  requireAutoReply?: boolean
}): Promise<null | {
  model: LanguageModel
  providerInstance?: AIProviderInstance
}> {
  const { providerInfo, workspaceId } = props
  const requireAutoReply = props.requireAutoReply ?? true

  if (isOpenaiCompatibleProviderModel(providerInfo)) {
    const integration =
      await integrationOpenaiCompatibleService.findByWorkspaceIdAndId({
        workspaceId,
        id: providerInfo.integrationId,
      })

    if (
      !(integration?.enabled && (!requireAutoReply || integration.autoReply))
    ) {
      logger.debug(
        {
          workspaceId,
          integrationId: providerInfo.integrationId,
          integrationFound: Boolean(integration),
          enabled: integration?.enabled ?? null,
          autoReply: integration?.autoReply ?? null,
        },
        "[automated-response] openaiCompatible provider skipped: integration missing, disabled, or auto-reply off",
      )
      return null
    }

    return {
      model: createOpenaiCompatibleModelInstance({
        integration,
        modelId: providerInfo.model,
      }),
    }
  }

  const integration = await getAIIntegrationInDB({
    workspaceId,
    provider: providerInfo.provider,
    autoReply: requireAutoReply ? true : undefined,
  })

  if (!integration) {
    logger.debug(
      { workspaceId, provider: providerInfo.provider },
      "[automated-response] provider skipped: no auto-reply-enabled integration found",
    )
    return null
  }

  const providerInstance = createAIProviderInstance({
    model: integration,
    provider: providerInfo.provider,
  })

  return {
    model: providerInstance(providerInfo.model),
    providerInstance,
  }
}

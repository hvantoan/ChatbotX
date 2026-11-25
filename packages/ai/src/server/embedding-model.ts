import { createGoogle } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { secretTextAuthSchema } from "@chatbotx.io/sdk"
import type { EmbeddingModel } from "ai"
import { geminiEmbeddingModels, openaiEmbeddingModels } from "../models"
import {
  getAIIntegrationInDB,
  getOpenaiCompatibleEmbeddingIntegrationInDB,
} from "./factory"
import { createOpenaiCompatibleEmbeddingModelInstance } from "./openai-compatible"

export type EmbeddingProvider = "openai" | "gemini" | "openaiCompatible"

/**
 * The workspace has no usable embedding provider: none is connected, or the
 * connected one has no usable key. Permanent until the workspace changes its
 * integrations, unlike a database or network failure while resolving.
 */
export class EmbeddingProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EmbeddingProviderNotConfiguredError"
  }
}

export type ResolvedEmbeddingModel = {
  model: EmbeddingModel
  modelId: string
  provider: EmbeddingProvider
}

export async function resolveEmbeddingModel(
  workspaceId: string,
): Promise<ResolvedEmbeddingModel> {
  const integrationOpenai = await getAIIntegrationInDB({
    workspaceId,
    provider: "openai",
  })

  if (integrationOpenai) {
    const authParsed = secretTextAuthSchema.safeParse(integrationOpenai.auth)
    if (!(authParsed.success && authParsed.data.secretText)) {
      throw new EmbeddingProviderNotConfiguredError(
        "Invalid OpenAI integration auth configuration",
      )
    }

    return {
      model: createOpenAI({ apiKey: authParsed.data.secretText }).embedding(
        openaiEmbeddingModels.enum["text-embedding-ada-002"],
      ),
      modelId: openaiEmbeddingModels.enum["text-embedding-ada-002"],
      provider: "openai",
    }
  }

  const integrationGemini = await getAIIntegrationInDB({
    workspaceId,
    provider: "gemini",
  })

  if (integrationGemini) {
    const authParsed = secretTextAuthSchema.safeParse(integrationGemini.auth)
    if (!(authParsed.success && authParsed.data.secretText)) {
      throw new EmbeddingProviderNotConfiguredError(
        "Invalid Gemini integration auth configuration",
      )
    }

    return {
      model: createGoogle({
        apiKey: authParsed.data.secretText,
      }).embedding(geminiEmbeddingModels.enum["gemini-embedding-001"]),
      modelId: geminiEmbeddingModels.enum["gemini-embedding-001"],
      provider: "gemini",
    }
  }

  // The `embedding` columns are fixed at 1536 dimensions
  // (packages/database/src/schema/ai-embedding.ts,
  // ai-conversation-embedding.ts), so the OpenAI-compatible embedding model
  // must return 1536 (text-embedding-3-small / ada-002).
  const integrationOpenaiCompatible =
    await getOpenaiCompatibleEmbeddingIntegrationInDB({ workspaceId })

  if (integrationOpenaiCompatible) {
    const modelId =
      process.env.OPENAI_COMPATIBLE_EMBEDDING_MODEL ??
      openaiEmbeddingModels.enum["text-embedding-3-small"]

    return {
      model: createOpenaiCompatibleEmbeddingModelInstance({
        integration: integrationOpenaiCompatible,
        modelId,
      }),
      modelId,
      provider: "openaiCompatible",
    }
  }

  throw new EmbeddingProviderNotConfiguredError(
    "No embedding provider configured. AI file embeddings require OpenAI, Gemini or an OpenAI-compatible integration. DeepSeek, Claude and Muse do not support embedding models.",
  )
}

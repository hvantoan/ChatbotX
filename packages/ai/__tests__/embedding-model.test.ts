import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findFirstGemini: vi.fn(),
  findFirstOpenai: vi.fn(),
  findFirstOpenaiCompatible: vi.fn(),
  geminiEmbedding: vi.fn(),
  openaiEmbedding: vi.fn(),
  openaiCompatibleEmbedding: vi.fn(),
}))

vi.mock("@inboxos.io/database/client", () => ({
  db: {
    query: {
      integrationGeminiModel: { findFirst: mocks.findFirstGemini },
      integrationOpenaiModel: { findFirst: mocks.findFirstOpenai },
      integrationOpenaiCompatibleModel: {
        findFirst: mocks.findFirstOpenaiCompatible,
      },
    },
  },
}))

vi.mock("@ai-sdk/google", () => ({
  createGoogle: () => ({ embedding: mocks.geminiEmbedding }),
}))

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ embedding: mocks.openaiEmbedding }),
}))

vi.mock("../src/server/openai-compatible", () => ({
  createOpenaiCompatibleEmbeddingModelInstance: mocks.openaiCompatibleEmbedding,
}))

const { resolveEmbeddingModel } = await import("../src/server/embedding-model")

describe("resolveEmbeddingModel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findFirstOpenai.mockResolvedValue(undefined)
    mocks.findFirstOpenaiCompatible.mockResolvedValue(undefined)
    mocks.findFirstGemini.mockResolvedValue({
      auth: { authType: "secretText", secretText: "gemini-key" },
    })
    mocks.geminiEmbedding.mockReturnValue("gemini-embedding-model")
  })

  afterEach(() => {
    delete process.env.OPENAI_COMPATIBLE_EMBEDDING_MODEL
  })

  test("resolves Gemini when it is the only configured provider", async () => {
    await expect(resolveEmbeddingModel("workspace-1")).resolves.toEqual({
      model: "gemini-embedding-model",
      modelId: "gemini-embedding-001",
      provider: "gemini",
    })

    expect(mocks.geminiEmbedding).toHaveBeenCalledWith("gemini-embedding-001")
    expect(mocks.openaiEmbedding).not.toHaveBeenCalled()
  })

  test("resolves an OpenAI-compatible integration when openai and gemini are absent", async () => {
    mocks.findFirstGemini.mockResolvedValue(undefined)
    mocks.findFirstOpenaiCompatible.mockResolvedValue({
      baseURL: "https://gateway.test/v1",
      defaultModel: "some-chat-model",
      enabled: true,
    })
    mocks.openaiCompatibleEmbedding.mockReturnValue(
      "openai-compatible-embedding-model",
    )

    await expect(resolveEmbeddingModel("workspace-1")).resolves.toEqual({
      model: "openai-compatible-embedding-model",
      modelId: "text-embedding-3-small",
      provider: "openaiCompatible",
    })

    expect(mocks.findFirstOpenaiCompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true, workspaceId: "workspace-1" },
      }),
    )
    expect(mocks.openaiCompatibleEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "text-embedding-3-small" }),
    )

    process.env.OPENAI_COMPATIBLE_EMBEDDING_MODEL = "custom-embedding-model"

    await expect(resolveEmbeddingModel("workspace-1")).resolves.toEqual({
      model: "openai-compatible-embedding-model",
      modelId: "custom-embedding-model",
      provider: "openaiCompatible",
    })

    expect(mocks.openaiCompatibleEmbedding).toHaveBeenLastCalledWith(
      expect.objectContaining({ modelId: "custom-embedding-model" }),
    )
  })

  test("keeps openai and gemini ahead of openaiCompatible", async () => {
    mocks.findFirstOpenai.mockResolvedValue({
      auth: { authType: "secretText", secretText: "openai-key" },
    })
    mocks.openaiEmbedding.mockReturnValue("openai-embedding-model")
    mocks.findFirstOpenaiCompatible.mockResolvedValue({
      baseURL: "https://gateway.test/v1",
      defaultModel: "some-chat-model",
      enabled: true,
    })

    await expect(resolveEmbeddingModel("workspace-1")).resolves.toEqual({
      model: "openai-embedding-model",
      modelId: "text-embedding-ada-002",
      provider: "openai",
    })
    expect(mocks.openaiCompatibleEmbedding).not.toHaveBeenCalled()

    mocks.findFirstOpenai.mockResolvedValue(undefined)

    await expect(resolveEmbeddingModel("workspace-1")).resolves.toEqual({
      model: "gemini-embedding-model",
      modelId: "gemini-embedding-001",
      provider: "gemini",
    })
    expect(mocks.openaiCompatibleEmbedding).not.toHaveBeenCalled()
  })
})

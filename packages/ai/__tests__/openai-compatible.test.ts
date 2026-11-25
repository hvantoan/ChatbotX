import type { IntegrationOpenaiCompatibleModel } from "@chatbotx.io/database/types"
import { describe, expect, test, vi } from "vitest"

const providerModelMock = vi.hoisted(() => vi.fn((modelId: string) => modelId))
const createOpenAICompatibleMock = vi.hoisted(() =>
  vi.fn(() => providerModelMock),
)

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: createOpenAICompatibleMock,
}))

const { createOpenaiCompatibleFetch, createOpenaiCompatibleModelInstance } =
  await import("../src/server/openai-compatible")

function createIntegration(
  overrides: Partial<IntegrationOpenaiCompatibleModel> = {},
): IntegrationOpenaiCompatibleModel {
  return {
    id: "1",
    auth: null,
    autoReply: false,
    baseURL: "http://localhost:1234/v1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    defaultModel: "llama-3.2-1b",
    enabled: true,
    integrationId: "10",
    name: "Local",
    preset: "lmstudio",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    workspaceId: "100",
    ...overrides,
  }
}

describe("OpenAI-compatible model helper", () => {
  test("creates a model without api key for local providers", () => {
    const result = createOpenaiCompatibleModelInstance({
      integration: createIntegration(),
      modelId: "local-model",
    })

    expect(result).toBe("local-model")
    expect(createOpenAICompatibleMock).toHaveBeenCalledWith({
      name: "lmstudio",
      baseURL: "http://localhost:1234/v1",
      apiKey: undefined,
      fetch: expect.any(Function),
    })
    expect(providerModelMock).toHaveBeenCalledWith("local-model")
  })

  test("passes secret text api key", () => {
    createOpenaiCompatibleModelInstance({
      integration: createIntegration({
        auth: { authType: "secretText", secretText: "provider-key" },
        baseURL: "https://example.com/v1",
        preset: "nim",
      }),
      modelId: "deepseek-ai/deepseek-r1",
    })

    expect(createOpenAICompatibleMock).toHaveBeenLastCalledWith({
      name: "nim",
      baseURL: "https://example.com/v1",
      apiKey: "provider-key",
      fetch: expect.any(Function),
    })
  })

  test("passes custom provider configuration through to the SDK", () => {
    createOpenaiCompatibleModelInstance({
      integration: createIntegration({
        auth: { authType: "secretText", secretText: "woku-key" },
        baseURL: "https://llm.wokushop.com/v1",
        preset: "custom",
      }),
      modelId: "gpt-4o-mini",
    })

    expect(createOpenAICompatibleMock).toHaveBeenLastCalledWith({
      name: "custom",
      baseURL: "https://llm.wokushop.com/v1",
      apiKey: "woku-key",
      fetch: expect.any(Function),
    })
    expect(providerModelMock).toHaveBeenLastCalledWith("gpt-4o-mini")
  })

  test("throws a clear error for non-null invalid auth config", () => {
    expect(() =>
      createOpenaiCompatibleModelInstance({
        integration: createIntegration({
          auth: { authType: "custom", apiKey: "secret" },
        }),
        modelId: "local-model",
      }),
    ).toThrow("OpenAI-compatible provider auth config is invalid.")
  })

  test("keeps the nearai request-body transform", () => {
    createOpenaiCompatibleModelInstance({
      integration: createIntegration({
        auth: { authType: "secretText", secretText: "near-key" },
        baseURL: "https://api.near.ai/v1",
        preset: "nearai",
      }),
      modelId: "nearai-model",
    })

    const config = createOpenAICompatibleMock.mock.calls.at(-1)?.[0]
    expect(config).toMatchObject({
      name: "nearai",
      baseURL: "https://api.near.ai/v1",
      apiKey: "near-key",
    })
    expect(
      config.transformRequestBody({ reasoning_effort: "low", prompt: "x" }),
    ).toEqual({
      prompt: "x",
    })
  })

  test("strips trailing data: [DONE] on non-stream text/event-stream JSON responses", async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"id":"gen-1","choices":[]}data: [DONE]\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    )
    const wrapped = createOpenaiCompatibleFetch(mockFetch)

    const res = await wrapped("https://example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "m", stream: false }),
    })

    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({ id: "gen-1", choices: [] })
  })

  test("leaves streaming requests untouched", async () => {
    const rawSse = 'data: {"id":"1"}\n\ndata: [DONE]\n\n'
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(rawSse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    )
    const wrapped = createOpenaiCompatibleFetch(mockFetch)

    const res = await wrapped("https://example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "m", stream: true }),
    })

    expect(res.headers.get("content-type")).toBe("text/event-stream")
    expect(await res.text()).toBe(rawSse)
  })
})

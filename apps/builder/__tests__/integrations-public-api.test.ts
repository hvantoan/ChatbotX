import { beforeEach, describe, expect, test, vi } from "vitest"

type RouteConfig = {
  method: string
  path: string
  summary: string
  tags: string[]
  successStatus?: number
  deprecated?: boolean
}

type CapturedProcedure = {
  route: RouteConfig
  handler?: (...args: any[]) => any
}

const { workspaceTokenAuthAPIForScope, capturedProcedures } = vi.hoisted(() => {
  const capturedProcedures: CapturedProcedure[] = []

  const makeProcedure = (route: RouteConfig) => {
    const record: CapturedProcedure = { route }
    capturedProcedures.push(record)

    const chain = {
      input: vi.fn(() => chain),
      output: vi.fn(() => chain),
      errors: vi.fn(() => chain),
      handler: vi.fn((fn: (...args: any[]) => any) => {
        record.handler = fn
        return { handler: fn }
      }),
    }
    return chain
  }

  const workspaceTokenAuthAPI = {
    route: vi.fn((config: RouteConfig) => makeProcedure(config)),
  }

  return {
    workspaceTokenAuthAPIForScope: vi.fn(
      (_scope: string) => workspaceTokenAuthAPI,
    ),
    capturedProcedures,
  }
})

vi.mock("@/orpc", () => ({ workspaceTokenAuthAPIForScope }))

class MockChatbotXException extends Error {
  code: string
  constructor(message: string, code = "systemError") {
    super(message)
    this.code = code
  }
}

vi.mock("@chatbotx.io/business/errors", () => ({
  BROADCAST_PLAN_LIMIT_CODE: "broadcastPlanLimit",
  IMAGES_NOT_SUPPORTED_ON_CHANNEL_CODE: "imagesNotSupportedOnChannel",
  PRODUCT_MESSAGE_UNRESOLVABLE_CODE: "productMessageUnresolvable",
  notFoundException: vi.fn(
    (message: string) => new MockChatbotXException(message, "notFound"),
  ),
  validationException: vi.fn(
    (_field: string, message: string) =>
      new MockChatbotXException(message, "validation"),
  ),
}))

const aiIntegrationService = {
  invalidateCache: vi.fn(),
}

vi.mock("@chatbotx.io/ai/server", () => ({ aiIntegrationService }))
vi.mock("@chatbotx.io/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@chatbotx.io/ai")>()
  return {
    ...actual,
    aiProviders: {
      enum: {
        claude: "claude",
        deepseek: "deepseek",
        gemini: "gemini",
        muse: "muse",
        openai: "openai",
      },
    },
  }
})

const integrationService = {
  listByWorkspaceId: vi.fn(),
  findByIdForWorkspace: vi.fn(),
  findTokenRefreshErrorsByWorkspaceId: vi.fn(),
}

const integrationClaudeService = {
  findByWorkspaceId: vi.fn(),
  connect: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
}
const integrationDeepSeekService = {
  findByWorkspaceId: vi.fn(),
  connect: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
}
const integrationGeminiService = {
  findByWorkspaceId: vi.fn(),
  connect: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
}
const integrationMuseService = {
  findByWorkspaceId: vi.fn(),
  connect: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
}
const integrationOpenAIService = {
  findByWorkspaceId: vi.fn(),
  connect: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
}

const integrationOpenaiCompatibleService = {
  listByWorkspaceId: vi.fn(),
  findByWorkspaceIdAndAnyId: vi.fn(),
  updateWithVerification: vi.fn(),
}

const connectionStateService = { findByProviderSourceId: vi.fn() }

vi.mock("@chatbotx.io/business", () => ({
  integrationService,
  integrationClaudeService,
  integrationDeepSeekService,
  integrationGeminiService,
  integrationMuseService,
  integrationOpenAIService,
  integrationOpenaiCompatibleService,
  connectionStateService,
}))

const connectionService = {
  disconnect: vi.fn(),
  connectFromCredentials: vi.fn(),
}
vi.mock("@chatbotx.io/connections", () => ({ connectionService }))

const { updateAiProviderRequest } = await import(
  "@/features/integrations/schema/ai-provider"
)

await import("@/features/integrations/api/public/crud")
await import("@/features/integrations/api/public/ai")

const findProcedure = (method: string, path: string) => {
  const found = capturedProcedures.find(
    (p) => p.route.method === method && p.route.path === path,
  )
  if (!found) {
    throw new Error(`No procedure registered for ${method} ${path}`)
  }
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /v1/integrations", () => {
  const procedure = findProcedure("GET", "/v1/integrations")

  test("delegates to integrationService.listByWorkspaceId", async () => {
    integrationService.listByWorkspaceId.mockResolvedValueOnce([
      { id: "integration-1" },
    ])

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { page: 1, perPage: 50 },
    })

    expect(result).toEqual({ data: [{ id: "integration-1" }], pageCount: 1 })
    expect(integrationService.listByWorkspaceId).toHaveBeenCalledWith(
      "workspace-1",
    )
  })
})

describe("GET /v1/integrations/{id}", () => {
  const procedure = findProcedure("GET", "/v1/integrations/{id}")

  test("delegates to integrationService.findByIdForWorkspace", async () => {
    integrationService.findByIdForWorkspace.mockResolvedValueOnce({
      id: "integration-1",
    })

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { id: "integration-1" },
    })

    expect(result).toEqual({ id: "integration-1" })
    expect(integrationService.findByIdForWorkspace).toHaveBeenCalledWith({
      id: "integration-1",
      workspaceId: "workspace-1",
    })
  })

  test("throws notFound when the integration does not exist", async () => {
    integrationService.findByIdForWorkspace.mockResolvedValueOnce(undefined)

    await expect(
      procedure.handler?.({
        context: { workspace: { id: "workspace-1" } },
        input: { id: "missing" },
      }),
    ).rejects.toThrow("Integration not found")
  })
})

describe("GET /v1/integrations/status/token-errors", () => {
  const procedure = findProcedure("GET", "/v1/integrations/status/token-errors")

  test("delegates to integrationService.findTokenRefreshErrorsByWorkspaceId", async () => {
    integrationService.findTokenRefreshErrorsByWorkspaceId.mockResolvedValueOnce(
      [{ id: "zalo-1", channel: "zalo", name: "Shop", error: "expired" }],
    )

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
    })

    expect(result).toEqual({
      data: [{ id: "zalo-1", channel: "zalo", name: "Shop", error: "expired" }],
    })
  })
})

describe("GET /v1/integrations/ai/{provider}", () => {
  const procedure = findProcedure("GET", "/v1/integrations/ai/{provider}")

  test("never returns the secret auth field", async () => {
    integrationClaudeService.findByWorkspaceId.mockResolvedValueOnce({
      id: "claude-1",
      model: "claude-opus",
      temperature: 0.4,
      maxOutputTokens: 1024,
      autoReply: true,
      auth: { authType: "secretText", secretText: "sk-real-secret-value" },
    })

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "claude" },
    })

    expect(result).toEqual({
      id: "claude-1",
      model: "claude-opus",
      temperature: 0.4,
      maxOutputTokens: 1024,
      autoReply: true,
      hasApiKey: true,
    })
    expect(JSON.stringify(result)).not.toContain("sk-real-secret-value")
    expect(result).not.toHaveProperty("auth")
  })

  test("hasApiKey is false when no auth is stored", async () => {
    integrationClaudeService.findByWorkspaceId.mockResolvedValueOnce({
      id: "claude-1",
      model: "claude-opus",
      temperature: null,
      maxOutputTokens: 1024,
      autoReply: false,
      auth: null,
    })

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "claude" },
    })

    expect(result).toMatchObject({ hasApiKey: false })
  })

  test("throws notFound when the provider is not connected", async () => {
    integrationClaudeService.findByWorkspaceId.mockResolvedValueOnce(undefined)

    await expect(
      procedure.handler?.({
        context: { workspace: { id: "workspace-1" } },
        input: { provider: "claude" },
      }),
    ).rejects.toThrow("claude integration not found")
  })

  test("dispatches to the correct provider service", async () => {
    integrationOpenAIService.findByWorkspaceId.mockResolvedValueOnce({
      id: "openai-1",
      model: "gpt-5",
      temperature: 1,
      maxOutputTokens: 2048,
      autoReply: true,
      auth: { authType: "secretText", secretText: "sk-openai" },
    })

    await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "openai" },
    })

    expect(integrationOpenAIService.findByWorkspaceId).toHaveBeenCalledWith(
      "workspace-1",
    )
    expect(integrationClaudeService.findByWorkspaceId).not.toHaveBeenCalled()
  })

  test("dispatches the muse provider to the Muse service", async () => {
    integrationMuseService.findByWorkspaceId.mockResolvedValueOnce({
      id: "muse-1",
      model: "muse-spark-1.3",
      temperature: 0.4,
      maxOutputTokens: 4096,
      autoReply: false,
      auth: { authType: "secretText", secretText: "muse-key" },
    })

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "muse" },
    })

    expect(integrationMuseService.findByWorkspaceId).toHaveBeenCalledWith(
      "workspace-1",
    )
    expect(result).toEqual({
      id: "muse-1",
      model: "muse-spark-1.3",
      temperature: 0.4,
      maxOutputTokens: 4096,
      autoReply: false,
      hasApiKey: true,
    })
  })
})

describe("PUT /v1/integrations/ai/{provider}", () => {
  const procedure = findProcedure("PUT", "/v1/integrations/ai/{provider}")

  test("connects via connectionService.connectFromCredentials with allowUpdate, then returns the resource without the secret", async () => {
    connectionService.connectFromCredentials.mockResolvedValueOnce({
      id: "conn-1",
    })
    integrationGeminiService.findByWorkspaceId.mockResolvedValueOnce({
      id: "gemini-1",
      model: "gemini-3.5-flash",
      temperature: 0.4,
      maxOutputTokens: 1024,
      autoReply: false,
      auth: { authType: "secretText", secretText: "sk-gemini-secret" },
    })

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: {
        provider: "gemini",
        apiKey: "sk-gemini-secret",
        model: "gemini-3.5-flash",
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    })

    expect(connectionService.connectFromCredentials).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      provider: "gemini",
      config: {
        apiKey: "sk-gemini-secret",
        model: "gemini-3.5-flash",
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
      allowUpdate: true,
    })
    expect(JSON.stringify(result)).not.toContain("sk-gemini-secret")
  })

  test("invalidates the AI integration cache after connecting", async () => {
    connectionService.connectFromCredentials.mockResolvedValueOnce({
      id: "conn-1",
    })
    integrationGeminiService.findByWorkspaceId.mockResolvedValueOnce({
      id: "gemini-1",
      model: "gemini-3.5-flash",
      temperature: 0.4,
      maxOutputTokens: 1024,
      autoReply: false,
      auth: { authType: "secretText", secretText: "sk-gemini-secret" },
    })

    await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: {
        provider: "gemini",
        apiKey: "sk-gemini-secret",
        model: "gemini-3.5-flash",
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    })

    expect(aiIntegrationService.invalidateCache).toHaveBeenCalledWith(
      "workspace-1",
      "gemini",
    )
  })

  test("propagates connectionCredentialsRejected without invalidating the cache", async () => {
    connectionService.connectFromCredentials.mockRejectedValueOnce(
      new MockChatbotXException(
        "Invalid Gemini API key",
        "connectionCredentialsRejected",
      ),
    )

    await expect(
      procedure.handler?.({
        context: { workspace: { id: "workspace-1" } },
        input: {
          provider: "gemini",
          apiKey: "bad-key",
          model: "gemini-3.5-flash",
          temperature: 0.4,
          maxOutputTokens: 1024,
        },
      }),
    ).rejects.toThrow()

    expect(aiIntegrationService.invalidateCache).not.toHaveBeenCalled()
  })

  test("is marked deprecated", () => {
    expect(procedure.route.deprecated).toBe(true)
  })
})

describe("DELETE /v1/integrations/ai/{provider}", () => {
  const procedure = findProcedure("DELETE", "/v1/integrations/ai/{provider}")

  test("resolves the Connection by (workspaceId, provider, 'workspace') and disconnects through connectionService", async () => {
    connectionStateService.findByProviderSourceId.mockResolvedValueOnce({
      id: "conn-1",
    })

    await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "deepseek" },
    })

    expect(connectionStateService.findByProviderSourceId).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      provider: "deepseek",
      sourceId: "workspace",
    })
    expect(connectionService.disconnect).toHaveBeenCalledWith({
      connectionId: "conn-1",
      workspaceId: "workspace-1",
    })
  })

  test("no-ops the Connection-domain disconnect call (idempotent) and falls back to the legacy per-provider disconnect when no Connection row exists yet (regression: a stored API key previously survived a silent no-op disconnect)", async () => {
    connectionStateService.findByProviderSourceId.mockResolvedValueOnce(
      undefined,
    )

    await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "deepseek" },
    })

    expect(connectionService.disconnect).not.toHaveBeenCalled()
    expect(integrationDeepSeekService.disconnect).toHaveBeenCalledWith(
      "workspace-1",
    )
  })

  test("invalidates the AI integration cache after disconnecting", async () => {
    connectionStateService.findByProviderSourceId.mockResolvedValueOnce({
      id: "conn-1",
    })

    await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "deepseek" },
    })

    expect(aiIntegrationService.invalidateCache).toHaveBeenCalledWith(
      "workspace-1",
      "deepseek",
    )
  })

  test("invalidates the cache even when there was nothing to disconnect", async () => {
    connectionStateService.findByProviderSourceId.mockResolvedValueOnce(
      undefined,
    )

    await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "deepseek" },
    })

    expect(aiIntegrationService.invalidateCache).toHaveBeenCalledWith(
      "workspace-1",
      "deepseek",
    )
  })

  test("responds with 204 (no body)", () => {
    expect(procedure.route.successStatus).toBe(204)
  })

  test("is marked deprecated", () => {
    expect(procedure.route.deprecated).toBe(true)
  })
})

describe("PATCH /v1/integrations/ai/{provider}", () => {
  const procedure = findProcedure("PATCH", "/v1/integrations/ai/{provider}")

  const row = (autoReply: boolean) => ({
    id: "row-1",
    model: "m",
    temperature: 0.5,
    maxOutputTokens: 1024,
    autoReply,
    auth: { authType: "secretText", secretText: "sk-secret" },
  })

  const services = {
    claude: integrationClaudeService,
    deepseek: integrationDeepSeekService,
    gemini: integrationGeminiService,
    muse: integrationMuseService,
    openai: integrationOpenAIService,
  } as const

  test("is registered under the Integrations tag", () => {
    expect(procedure.route.tags).toEqual(["Integrations"])
    expect(procedure.route.summary).toBe("Update AI provider settings")
  })

  test.each(
    Object.keys(services) as (keyof typeof services)[],
  )("%s: updates autoReply, invalidates the cache, returns the fresh resource without the secret", async (provider) => {
    const service = services[provider]
    service.findByWorkspaceId
      .mockResolvedValueOnce(row(false))
      .mockResolvedValueOnce(row(true))

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider, autoReply: true },
    })

    expect(service.update).toHaveBeenCalledWith(
      provider === "openai"
        ? { workspaceId: "workspace-1", id: "row-1" }
        : { workspaceId: "workspace-1" },
      { autoReply: true },
    )
    expect(aiIntegrationService.invalidateCache).toHaveBeenCalledWith(
      "workspace-1",
      provider,
    )
    expect(result).toEqual({
      id: "row-1",
      model: "m",
      temperature: 0.5,
      maxOutputTokens: 1024,
      autoReply: true,
      hasApiKey: true,
    })
    expect(JSON.stringify(result)).not.toContain("sk-secret")
  })

  test("throws notFound without writing or invalidating when the provider is not connected", async () => {
    integrationMuseService.findByWorkspaceId.mockResolvedValueOnce(undefined)

    await expect(
      procedure.handler?.({
        context: { workspace: { id: "workspace-1" } },
        input: { provider: "muse", autoReply: true },
      }),
    ).rejects.toThrow("muse integration not found")

    expect(integrationMuseService.update).not.toHaveBeenCalled()
    expect(aiIntegrationService.invalidateCache).not.toHaveBeenCalled()
  })

  test("leaves the integration untouched when autoReply is omitted", async () => {
    integrationClaudeService.findByWorkspaceId
      .mockResolvedValueOnce(row(true))
      .mockResolvedValueOnce(row(true))

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "claude" },
    })

    expect(integrationClaudeService.update).not.toHaveBeenCalled()
    expect(aiIntegrationService.invalidateCache).not.toHaveBeenCalled()
    expect(result).toMatchObject({ id: "row-1", autoReply: true })
  })

  test("scopes the write to the token's workspace", async () => {
    integrationGeminiService.findByWorkspaceId
      .mockResolvedValueOnce(row(true))
      .mockResolvedValueOnce(row(false))

    await procedure.handler?.({
      context: { workspace: { id: "workspace-9" } },
      input: { provider: "gemini", autoReply: false },
    })

    expect(integrationGeminiService.findByWorkspaceId).toHaveBeenCalledWith(
      "workspace-9",
    )
    expect(integrationGeminiService.update).toHaveBeenCalledWith(
      { workspaceId: "workspace-9" },
      { autoReply: false },
    )
  })
})

describe("GET /v1/integrations/ai/openaiCompatible", () => {
  const procedure = findProcedure("GET", "/v1/integrations/ai/{provider}")

  const compatibleRow = {
    id: "sat-1",
    integrationId: "int-1",
    workspaceId: "workspace-1",
    name: "Local LM Studio",
    preset: "lmstudio",
    baseURL: "http://127.0.0.1:1234/v1",
    defaultModel: "local-model",
    enabled: true,
    autoReply: false,
    auth: { authType: "secretText", secretText: "sk-local-secret" },
  }

  test("lists connected openaiCompatible integrations with satellite id and no secrets or workspaceId", async () => {
    integrationOpenaiCompatibleService.listByWorkspaceId.mockResolvedValueOnce([
      compatibleRow,
    ])

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "openaiCompatible" },
    })

    expect(
      integrationOpenaiCompatibleService.listByWorkspaceId,
    ).toHaveBeenCalledWith("workspace-1")
    expect(result).toEqual({
      data: [
        {
          id: "sat-1",
          integrationId: "int-1",
          name: "Local LM Studio",
          preset: "lmstudio",
          baseURL: "http://127.0.0.1:1234/v1",
          defaultModel: "local-model",
          enabled: true,
          autoReply: false,
          hasApiKey: true,
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain("sk-local-secret")
    expect(JSON.stringify(result)).not.toContain("workspace-1")
  })

  test("filters by integrationId and throws 404 when not found", async () => {
    integrationOpenaiCompatibleService.findByWorkspaceIdAndAnyId
      .mockResolvedValueOnce(compatibleRow)
      .mockResolvedValueOnce(undefined)

    const found = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: { provider: "openaiCompatible", integrationId: "sat-1" },
    })
    expect(found).toEqual({
      data: [
        {
          id: "sat-1",
          integrationId: "int-1",
          name: "Local LM Studio",
          preset: "lmstudio",
          baseURL: "http://127.0.0.1:1234/v1",
          defaultModel: "local-model",
          enabled: true,
          autoReply: false,
          hasApiKey: true,
        },
      ],
    })

    await expect(
      procedure.handler?.({
        context: { workspace: { id: "workspace-1" } },
        input: { provider: "openaiCompatible", integrationId: "missing" },
      }),
    ).rejects.toThrow("openaiCompatible integration not found")
  })
})

describe("PATCH /v1/integrations/ai/openaiCompatible", () => {
  const procedure = findProcedure("PATCH", "/v1/integrations/ai/{provider}")

  const updatedRow = {
    id: "sat-1",
    integrationId: "int-1",
    workspaceId: "workspace-1",
    name: "Updated NIM",
    preset: "nim",
    baseURL: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.1-8b-instruct",
    enabled: true,
    autoReply: true,
    auth: { authType: "secretText", secretText: "sk-updated" },
  }

  test("requires integrationId when provider is openaiCompatible", async () => {
    await expect(
      procedure.handler?.({
        context: { workspace: { id: "workspace-1" } },
        input: { provider: "openaiCompatible", autoReply: true },
      }),
    ).rejects.toThrow("integrationId is required")

    expect(
      integrationOpenaiCompatibleService.updateWithVerification,
    ).not.toHaveBeenCalled()
  })

  test("delegates to updateWithVerification and returns updated satellite resource without secrets", async () => {
    integrationOpenaiCompatibleService.findByWorkspaceIdAndAnyId.mockResolvedValueOnce(
      { id: "sat-1", integrationId: "int-1" },
    )
    integrationOpenaiCompatibleService.updateWithVerification.mockResolvedValueOnce(
      updatedRow,
    )

    const result = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: {
        provider: "openaiCompatible",
        integrationId: "sat-1",
        autoReply: true,
        enabled: true,
        name: "Updated NIM",
        preset: "nim",
        baseURL: "https://integrate.api.nvidia.com/v1",
        apiKey: "sk-updated",
      },
    })

    expect(
      integrationOpenaiCompatibleService.updateWithVerification,
    ).toHaveBeenCalledWith(
      "workspace-1",
      "sat-1",
      expect.objectContaining({
        autoReply: true,
        enabled: true,
        name: "Updated NIM",
        preset: "nim",
        baseURL: "https://integrate.api.nvidia.com/v1",
        apiKey: "sk-updated",
        resolveDefaultModel: expect.any(Function),
      }),
    )
    expect(result).toEqual({
      id: "sat-1",
      integrationId: "int-1",
      name: "Updated NIM",
      preset: "nim",
      baseURL: "https://integrate.api.nvidia.com/v1",
      defaultModel: "meta/llama-3.1-8b-instruct",
      enabled: true,
      autoReply: true,
      hasApiKey: true,
    })
    expect(JSON.stringify(result)).not.toContain("sk-updated")
    expect(JSON.stringify(result)).not.toContain("workspace-1")
  })

  test("resolves parent integrationId to satellite id and skips write on empty PATCH", async () => {
    integrationOpenaiCompatibleService.findByWorkspaceIdAndAnyId.mockResolvedValueOnce(
      updatedRow,
    )

    const noopResult = await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: {
        provider: "openaiCompatible",
        integrationId: "int-1",
      },
    })

    expect(
      integrationOpenaiCompatibleService.updateWithVerification,
    ).not.toHaveBeenCalled()
    expect(noopResult).toMatchObject({ id: "sat-1", integrationId: "int-1" })

    integrationOpenaiCompatibleService.findByWorkspaceIdAndAnyId.mockResolvedValueOnce(
      updatedRow,
    )
    integrationOpenaiCompatibleService.updateWithVerification.mockResolvedValueOnce(
      updatedRow,
    )

    await procedure.handler?.({
      context: { workspace: { id: "workspace-1" } },
      input: {
        provider: "openaiCompatible",
        integrationId: "int-1",
        autoReply: true,
      },
    })

    expect(
      integrationOpenaiCompatibleService.updateWithVerification,
    ).toHaveBeenCalledWith(
      "workspace-1",
      "sat-1",
      expect.objectContaining({ autoReply: true }),
    )
  })

  test("updateAiProviderRequest enforces openaiCompatible vs legacy provider rules and bigint integrationId", () => {
    expect(
      updateAiProviderRequest.safeParse({
        provider: "openaiCompatible",
        autoReply: true,
      }).success,
    ).toBe(false)

    expect(
      updateAiProviderRequest.safeParse({
        provider: "openaiCompatible",
        integrationId: "not-a-bigint",
        autoReply: true,
      }).success,
    ).toBe(false)

    expect(
      updateAiProviderRequest.safeParse({
        provider: "openaiCompatible",
        integrationId: "123456789012345678",
        apiKey: "   ",
      }).success,
    ).toBe(false)

    expect(
      updateAiProviderRequest.safeParse({
        provider: "claude",
        integrationId: "123456789012345678",
        autoReply: true,
      }).success,
    ).toBe(false)

    expect(
      updateAiProviderRequest.safeParse({
        provider: "openaiCompatible",
        integrationId: "123456789012345678",
        autoReply: true,
      }).success,
    ).toBe(true)
  })
})

import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  connectFromCredentials: vi.fn(),
  isDuplicatePreset: vi.fn(() => false),
  returnValidationErrors: vi.fn(
    (_schema: unknown, errors: Record<string, unknown>) => ({
      validationErrors: errors,
    }),
  ),
  updateWithVerification: vi.fn(),
  validateBaseUrl: vi.fn(),
  verifyProvider: vi.fn(),
}))

vi.mock("@/lib/safe-action", () => {
  const chain: Record<string, unknown> = {}
  chain.bindArgsSchemas = () => chain
  chain.inputSchema = () => chain
  chain.action = (fn: unknown) => fn
  return { workspaceActionClient: chain }
})

vi.mock("@/features/common/schema", () => ({
  workspaceIdAndIdRequestParams: [],
  workspaceIdrequestParams: [],
}))

vi.mock("@chatbotx.io/business", () => ({
  integrationOpenaiCompatibleService: {
    connect: mocks.connect,
    updateWithVerification: mocks.updateWithVerification,
  },
  isOpenaiCompatiblePresetAlreadyConnectedError: mocks.isDuplicatePreset,
  validateOpenaiCompatibleBaseUrlForEnvironment: mocks.validateBaseUrl,
}))

vi.mock("@chatbotx.io/connections", () => ({
  connectionService: {
    connectFromCredentials: mocks.connectFromCredentials,
  },
}))

vi.mock("@chatbotx.io/business/errors", () => ({
  ChatbotXException: class ChatbotXException extends Error {
    code = "systemError"
    httpStatusCode = 400
    field?: string

    constructor(message: string, code?: string, httpStatusCode?: number) {
      super(message)
      this.name = "ChatbotXException"
      if (code) {
        this.code = code
      }
      if (httpStatusCode) {
        this.httpStatusCode = httpStatusCode
      }
    }
  },
}))

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}))

vi.mock("next-safe-action", () => ({
  returnValidationErrors: mocks.returnValidationErrors,
}))

vi.mock("@/features/integration-openai-compatible/lib", () => ({
  verifyOpenaiCompatibleProvider: mocks.verifyProvider,
}))

const { ChatbotXException } = await import("@chatbotx.io/business/errors")
const { connectOpenaiCompatibleAction } = await import(
  "@/features/integration-openai-compatible/actions/connect.action"
)
const { updateOpenaiCompatibleAction, updateOpenaiCompatibleEnabledAction } =
  await import("@/features/integration-openai-compatible/actions/update.action")

type ActionHandler<TParsedInput, TBindArgs extends unknown[]> = (props: {
  parsedInput: TParsedInput
  bindArgsParsedInputs: TBindArgs
}) => Promise<unknown>

const baseInput = {
  apiKey: "secret",
  autoReply: false,
  baseURL: "https://example.com/v1",
  enabled: true,
  name: "Provider",
  preset: "custom",
}

describe("OpenAI-compatible actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateBaseUrl.mockImplementation(async (baseURL: string) =>
      baseURL.trim(),
    )
    mocks.verifyProvider.mockResolvedValue({ ok: true })
    mocks.updateWithVerification.mockResolvedValue({
      id: "integration-1",
    })
  })

  test("connect maps unsafe base URL errors before provider verification", async () => {
    mocks.validateBaseUrl.mockRejectedValue(
      new ChatbotXException("blocked", "ssrfBlocked", 400),
    )

    const result = await (
      connectOpenaiCompatibleAction as unknown as ActionHandler<
        typeof baseInput,
        [string]
      >
    )({
      parsedInput: baseInput,
      bindArgsParsedInputs: ["workspace-1"],
    })

    expect(result).toEqual({
      validationErrors: {
        baseURL: {
          _errors: ["openaiCompatible.validation.invalidBaseURL"],
        },
      },
    })
    expect(mocks.verifyProvider).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  test("connect calls connectFromCredentials with the validated baseURL and no allowUpdate (always a fresh connect)", async () => {
    const result = await (
      connectOpenaiCompatibleAction as unknown as ActionHandler<
        typeof baseInput,
        [string]
      >
    )({
      parsedInput: baseInput,
      bindArgsParsedInputs: ["workspace-1"],
    })

    expect(result).toBeUndefined()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.connectFromCredentials).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      provider: "openaiCompatible",
      config: {
        ...baseInput,
        baseURL: baseInput.baseURL,
        defaultModel: "gpt-4o-mini",
      },
    })
    expect(mocks.connectFromCredentials.mock.calls[0]?.[0]).not.toHaveProperty(
      "allowUpdate",
    )
  })

  test("connect maps a connectionAlreadyConnected error from connectFromCredentials to a localized preset validation error instead of letting it propagate", async () => {
    mocks.connectFromCredentials.mockRejectedValue(
      new ChatbotXException(
        "This provider is already connected in this workspace.",
        "connectionAlreadyConnected",
        409,
      ),
    )

    const result = await (
      connectOpenaiCompatibleAction as unknown as ActionHandler<
        typeof baseInput,
        [string]
      >
    )({
      parsedInput: baseInput,
      bindArgsParsedInputs: ["workspace-1"],
    })

    expect(result).toEqual({
      validationErrors: {
        preset: {
          _errors: ["openaiCompatible.validation.presetAlreadyConnected"],
        },
      },
    })
  })

  test("update delegates to updateWithVerification and maps ssrfBlocked to baseURL validation error", async () => {
    mocks.updateWithVerification.mockRejectedValue(
      new ChatbotXException("blocked", "ssrfBlocked", 400),
    )

    const result = await (
      updateOpenaiCompatibleAction as unknown as ActionHandler<
        { apiKey: string },
        [string, string]
      >
    )({
      parsedInput: { apiKey: "new-key" },
      bindArgsParsedInputs: ["workspace-1", "integration-1"],
    })

    expect(mocks.updateWithVerification).toHaveBeenCalledWith(
      "workspace-1",
      "integration-1",
      expect.objectContaining({
        apiKey: "new-key",
        resolveDefaultModel: expect.any(Function),
      }),
    )
    expect(result).toEqual({
      validationErrors: {
        baseURL: {
          _errors: ["openaiCompatible.validation.invalidBaseURL"],
        },
      },
    })
  })

  test("update maps connectionCredentialsRejected, apiKey validation, connectionAlreadyConnected, and presetAlreadyConnected", async () => {
    mocks.updateWithVerification.mockRejectedValueOnce(
      new ChatbotXException("rejected", "connectionCredentialsRejected", 400),
    )

    const rejected = await (
      updateOpenaiCompatibleAction as unknown as ActionHandler<
        { apiKey: string },
        [string, string]
      >
    )({
      parsedInput: { apiKey: "bad-key" },
      bindArgsParsedInputs: ["workspace-1", "integration-1"],
    })

    expect(rejected).toEqual({
      validationErrors: {
        apiKey: {
          _errors: ["validation.invalidApiKey"],
        },
      },
    })

    const apiKeyValidationError = new ChatbotXException(
      "Provide an API key",
      "validation",
      422,
    )
    apiKeyValidationError.field = "apiKey"
    mocks.updateWithVerification.mockRejectedValueOnce(apiKeyValidationError)

    const crossOrigin = await (
      updateOpenaiCompatibleAction as unknown as ActionHandler<
        { baseURL: string },
        [string, string]
      >
    )({
      parsedInput: { baseURL: "https://other.example.com/v1" },
      bindArgsParsedInputs: ["workspace-1", "integration-1"],
    })
    expect(crossOrigin).toEqual({
      validationErrors: {
        apiKey: {
          _errors: ["validation.invalidApiKey"],
        },
      },
    })

    mocks.updateWithVerification.mockRejectedValueOnce(
      new ChatbotXException("duplicate url", "connectionAlreadyConnected", 409),
    )
    const duplicateUrl = await (
      updateOpenaiCompatibleAction as unknown as ActionHandler<
        { baseURL: string },
        [string, string]
      >
    )({
      parsedInput: { baseURL: "https://dup.example.com/v1" },
      bindArgsParsedInputs: ["workspace-1", "integration-1"],
    })
    expect(duplicateUrl).toEqual({
      validationErrors: {
        baseURL: {
          _errors: ["openaiCompatible.validation.invalidBaseURL"],
        },
      },
    })

    const presetErr = new ChatbotXException(
      "duplicate preset",
      "presetAlreadyConnected",
      409,
    )
    mocks.isDuplicatePreset.mockReturnValueOnce(true)
    mocks.updateWithVerification.mockRejectedValueOnce(presetErr)
    const duplicatePreset = await (
      updateOpenaiCompatibleAction as unknown as ActionHandler<
        { preset: string },
        [string, string]
      >
    )({
      parsedInput: { preset: "nim" },
      bindArgsParsedInputs: ["workspace-1", "integration-1"],
    })
    expect(duplicatePreset).toEqual({
      validationErrors: {
        preset: {
          _errors: ["openaiCompatible.validation.presetAlreadyConnected"],
        },
      },
    })
  })

  test("updateEnabled delegates to the same updateWithVerification service method", async () => {
    await (
      updateOpenaiCompatibleEnabledAction as unknown as ActionHandler<
        { autoReply?: boolean; enabled?: boolean },
        [string, string]
      >
    )({
      parsedInput: { autoReply: true, enabled: false },
      bindArgsParsedInputs: ["workspace-1", "integration-1"],
    })

    expect(mocks.updateWithVerification).toHaveBeenCalledWith(
      "workspace-1",
      "integration-1",
      { autoReply: true, enabled: false },
    )
  })
})

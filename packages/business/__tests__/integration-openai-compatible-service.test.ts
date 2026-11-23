import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(async () => []),
  insertReturning: vi.fn(),
  insertValues: vi.fn(),
  transaction: vi.fn(),
  txUpdateSet: vi.fn(),
  txUpdateWhere: vi.fn(),
  updateReturning: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  validateBaseUrl: vi.fn(async (baseURL: string) => baseURL.trim()),
  verifyProvider: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock("../src/integration-openai-compatible/validate-base-url", () => ({
  normalizeOpenaiCompatibleBaseUrl: (baseURL: string) => baseURL.trim(),
  validateOpenaiCompatibleBaseUrlForEnvironment: mocks.validateBaseUrl,
}))

vi.mock("../src/integration-openai-compatible/verify", () => ({
  verifyOpenaiCompatibleProvider: mocks.verifyProvider,
}))

vi.mock("../src/audit/dispatcher", () => ({ dispatchAuditRecord: vi.fn() }))

vi.mock("@chatbotx.io/database/client", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  db: {
    query: {
      integrationOpenaiCompatibleModel: {
        findFirst: mocks.findFirst,
        findMany: mocks.findMany,
      },
    },
    transaction: mocks.transaction,
    update: vi.fn(() => ({
      set: mocks.updateSet,
    })),
  },
  eq: vi.fn((col: unknown, val: unknown) => ({ eq: [col, val] })),
  isDatabaseError: vi.fn((err: unknown) =>
    Boolean(err && typeof err === "object" && "cause" in err),
  ),
}))

vi.mock("@chatbotx.io/database/schema", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@chatbotx.io/database/schema")>()),
  connectionModel: {
    id: "conn.id",
    integrationId: "conn.integrationId",
    provider: "conn.provider",
    workspaceId: "conn.workspaceId",
  },
  integrationModel: { id: "id" },
  integrationOpenaiCompatibleModel: {
    baseURL: "baseURL",
    id: "id",
    integrationId: "integrationId",
    workspaceId: "workspaceId",
  },
}))

vi.mock("@chatbotx.io/redis", () => ({
  invalidateCacheByTags: vi.fn(),
}))

vi.mock("@chatbotx.io/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@chatbotx.io/utils")>()),
  createId: vi.fn(() => "generated-id"),
}))

const { integrationOpenaiCompatibleService } = await import(
  "../src/integration-openai-compatible/service"
)

describe("IntegrationOpenaiCompatibleService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findMany.mockResolvedValue([])
    mocks.validateBaseUrl.mockImplementation(async (baseURL: string) =>
      baseURL.trim(),
    )
    mocks.verifyProvider.mockResolvedValue({ ok: true })
    mocks.insertReturning.mockResolvedValue([{ id: "integration-1" }])
    mocks.updateReturning.mockResolvedValue([
      { id: "openai-compatible-1", integrationId: "integration-1" },
    ])
    mocks.txUpdateWhere.mockReturnValue({ returning: mocks.updateReturning })
    mocks.txUpdateSet.mockReturnValue({ where: mocks.txUpdateWhere })
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        insert: vi.fn(() => ({
          values: (data: unknown) => {
            mocks.insertValues(data)
            return { returning: mocks.insertReturning }
          },
        })),
        update: vi.fn(() => ({
          set: mocks.txUpdateSet,
        })),
      }),
    )
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning })
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere })
  })

  test("validates and persists normalized base URL on connect", async () => {
    mocks.validateBaseUrl.mockResolvedValue("https://example.com/v1")

    await integrationOpenaiCompatibleService.connect({
      workspaceId: "workspace-1",
      name: "NIM",
      preset: "nim",
      baseURL: " https://example.com/v1 ",
      defaultModel: "model-1",
      apiKey: "secret",
    })

    expect(mocks.validateBaseUrl).toHaveBeenCalledWith(
      " https://example.com/v1 ",
    )
    expect(mocks.insertValues).toHaveBeenLastCalledWith(
      expect.objectContaining({
        baseURL: "https://example.com/v1",
      }),
    )
  })

  test("validates changed base URL on update and persists normalized value", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "openai-compatible-1",
      baseURL: "https://old.example.com/v1",
    })
    mocks.validateBaseUrl.mockResolvedValue("https://new.example.com/v1")

    await integrationOpenaiCompatibleService.update(
      "workspace-1",
      "openai-compatible-1",
      { baseURL: " https://new.example.com/v1 " },
    )

    expect(mocks.validateBaseUrl).toHaveBeenCalledWith(
      "https://new.example.com/v1",
    )
    expect(mocks.txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://new.example.com/v1",
      }),
    )
  })

  test("re-runs environment validation when baseURL is passed even if unchanged", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "openai-compatible-1",
      integrationId: "integration-1",
      baseURL: "https://example.com/v1",
      preset: "custom",
    })

    await integrationOpenaiCompatibleService.update(
      "workspace-1",
      "openai-compatible-1",
      { baseURL: " https://example.com/v1 " },
    )

    expect(mocks.validateBaseUrl).toHaveBeenCalledWith("https://example.com/v1")
    expect(mocks.txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://example.com/v1",
      }),
    )
  })

  test("ignores blank apiKey on update instead of wiping auth to null and no-ops when no values remain", async () => {
    const existing = {
      id: "openai-compatible-1",
      integrationId: "integration-1",
      baseURL: "https://example.com/v1",
      preset: "custom",
    }
    mocks.findFirst.mockResolvedValue(existing)

    await integrationOpenaiCompatibleService.update(
      "workspace-1",
      "openai-compatible-1",
      { apiKey: "   ", autoReply: true },
    )

    const updatePayload = mocks.txUpdateSet.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(updatePayload).toEqual({ autoReply: true })
    expect(updatePayload).not.toHaveProperty("auth")

    vi.clearAllMocks()
    mocks.findFirst.mockResolvedValue(existing)

    const noopEmpty = await integrationOpenaiCompatibleService.update(
      "workspace-1",
      "openai-compatible-1",
      {},
    )
    const noopBlankKey = await integrationOpenaiCompatibleService.update(
      "workspace-1",
      "openai-compatible-1",
      { apiKey: "   " },
    )

    expect(noopEmpty).toBe(existing)
    expect(noopBlankKey).toBe(existing)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.txUpdateSet).not.toHaveBeenCalled()
  })

  test("updateWithVerification throws 404 before verifying when row is missing", async () => {
    mocks.findFirst.mockResolvedValue(undefined)

    await expect(
      integrationOpenaiCompatibleService.updateWithVerification(
        "workspace-1",
        "missing-id",
        { baseURL: "https://new.example.com/v1", apiKey: "sk-new" },
      ),
    ).rejects.toMatchObject({ code: "notFound", httpStatusCode: 404 })

    expect(mocks.validateBaseUrl).not.toHaveBeenCalled()
    expect(mocks.verifyProvider).not.toHaveBeenCalled()
  })

  test("updateWithVerification blocks cross-origin baseURL swap without a new apiKey", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "openai-compatible-1",
      integrationId: "integration-1",
      baseURL: "https://trusted.example.com/v1",
      preset: "custom",
      auth: { authType: "secretText", secretText: "sk-existing" },
    })

    await expect(
      integrationOpenaiCompatibleService.updateWithVerification(
        "workspace-1",
        "openai-compatible-1",
        { baseURL: "https://attacker.example.com/v1" },
      ),
    ).rejects.toMatchObject({ code: "validation", httpStatusCode: 422 })

    expect(mocks.verifyProvider).not.toHaveBeenCalled()
  })

  test("updateWithVerification verifies existing baseURL on apiKey change and resolves defaultModel only on preset change", async () => {
    const existingRow = {
      id: "openai-compatible-1",
      integrationId: "integration-1",
      baseURL: "https://example.com/v1",
      preset: "custom",
      auth: { authType: "secretText", secretText: "sk-existing" },
    }
    mocks.findFirst.mockResolvedValue(existingRow)

    const resolveDefaultModel = vi.fn(() => "nim-default")

    await integrationOpenaiCompatibleService.updateWithVerification(
      "workspace-1",
      "openai-compatible-1",
      {
        apiKey: "sk-new",
        preset: "nim",
        autoReply: true,
        resolveDefaultModel,
      },
    )

    expect(mocks.validateBaseUrl).toHaveBeenCalledWith("https://example.com/v1")
    expect(mocks.verifyProvider).toHaveBeenCalledWith({
      apiKey: "sk-new",
      baseURL: "https://example.com/v1",
    })
    expect(resolveDefaultModel).toHaveBeenCalledWith("nim")
    expect(mocks.txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        autoReply: true,
        defaultModel: "nim-default",
        preset: "nim",
      }),
    )
  })

  test("update syncs Connection sourceId and displayName and maps duplicate sourceId to connectionAlreadyConnected", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "openai-compatible-1",
      integrationId: "integration-1",
      baseURL: "https://old.example.com/v1",
      name: "Old Name",
      preset: "custom",
    })

    await integrationOpenaiCompatibleService.update(
      "workspace-1",
      "openai-compatible-1",
      { baseURL: "https://new.example.com/v1", name: "New Name" },
    )

    expect(mocks.txUpdateSet).toHaveBeenCalledWith({
      sourceId: "https://new.example.com/v1",
      displayName: "New Name",
    })

    const duplicateErr = Object.assign(new Error("duplicate"), {
      code: "23505",
      constraint: "Connection_workspaceId_provider_sourceId_key",
    })
    const { DrizzleQueryError } = await import("drizzle-orm")
    mocks.transaction.mockRejectedValueOnce(
      new DrizzleQueryError("update", [], duplicateErr),
    )

    await expect(
      integrationOpenaiCompatibleService.update(
        "workspace-1",
        "openai-compatible-1",
        { baseURL: "https://other.example.com/v1" },
      ),
    ).rejects.toMatchObject({
      code: "connectionAlreadyConnected",
      httpStatusCode: 409,
    })
  })

  test("updateWithVerification maps verify failures to ssrfBlocked and connectionCredentialsRejected", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "openai-compatible-1",
      integrationId: "integration-1",
      baseURL: "https://example.com/v1",
      preset: "custom",
      auth: { authType: "secretText", secretText: "sk-existing" },
    })

    mocks.verifyProvider.mockResolvedValueOnce({
      ok: false,
      reason: "unsafe_base_url",
    })
    await expect(
      integrationOpenaiCompatibleService.updateWithVerification(
        "workspace-1",
        "openai-compatible-1",
        { apiKey: "sk-new" },
      ),
    ).rejects.toMatchObject({ code: "ssrfBlocked", httpStatusCode: 400 })

    mocks.verifyProvider.mockResolvedValueOnce({
      ok: false,
      reason: "unauthorized",
      status: 401,
    })
    await expect(
      integrationOpenaiCompatibleService.updateWithVerification(
        "workspace-1",
        "openai-compatible-1",
        { apiKey: "sk-bad" },
      ),
    ).rejects.toMatchObject({
      code: "connectionCredentialsRejected",
      httpStatusCode: 400,
    })

    mocks.verifyProvider.mockResolvedValueOnce({
      ok: false,
      reason: "unreachable",
      status: 404,
    })
    await expect(
      integrationOpenaiCompatibleService.updateWithVerification(
        "workspace-1",
        "openai-compatible-1",
        { baseURL: "https://example.com/v11" },
      ),
    ).rejects.toMatchObject({
      code: "invalidBaseUrl",
      httpStatusCode: 400,
      name: "OpenaiCompatibleProviderUnreachableError",
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  test("update does not overwrite connection displayName or sourceId when provider name and baseURL are unchanged", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "openai-compatible-1",
      integrationId: "integration-1",
      baseURL: "https://example.com/v1",
      name: "Custom Provider",
      defaultModel: "gpt-4o-mini",
      preset: "custom",
    })

    await integrationOpenaiCompatibleService.update(
      "workspace-1",
      "openai-compatible-1",
      {
        baseURL: "https://example.com/v1",
        name: "Custom Provider",
        defaultModel: "gpt-4o",
      },
    )

    expect(mocks.txUpdateSet).toHaveBeenCalledTimes(1)
    expect(mocks.txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: "gpt-4o",
      }),
    )
  })

  test("updateWithVerification fails with 409 conflict if baseURL changed concurrently before write", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "openai-compatible-1",
      integrationId: "integration-1",
      baseURL: "https://old.example.com/v1",
      preset: "custom",
      auth: { authType: "secretText", secretText: "sk-existing" },
    })
    mocks.updateReturning.mockResolvedValueOnce([])

    await expect(
      integrationOpenaiCompatibleService.updateWithVerification(
        "workspace-1",
        "openai-compatible-1",
        { apiKey: "sk-new" },
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      httpStatusCode: 409,
    })
    expect(mocks.txUpdateSet).toHaveBeenCalledTimes(1)
    expect(mocks.txUpdateWhere).toHaveBeenCalledWith(
      expect.objectContaining({
        and: expect.arrayContaining([
          { eq: ["baseURL", "https://old.example.com/v1"] },
        ]),
      }),
    )
  })

  test("findByWorkspaceIdAndAnyId falls back from satellite id to parent integrationId", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "sat-1", integrationId: "int-1" })

    const result =
      await integrationOpenaiCompatibleService.findByWorkspaceIdAndAnyId({
        workspaceId: "workspace-1",
        id: "int-1",
      })

    expect(result).toEqual({ id: "sat-1", integrationId: "int-1" })
  })

  test("updateWithVerification skips endpoint probe when baseURL is unchanged and no new apiKey is sent, while still running SSRF validation", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "openai-compatible-1",
      integrationId: "integration-1",
      baseURL: "https://example.com/v1",
      name: "Old Name",
      defaultModel: "model-a",
      preset: "custom",
      auth: { authType: "secretText", secretText: "sk-existing" },
    })
    mocks.verifyProvider.mockResolvedValue({
      ok: false,
      reason: "unreachable",
      status: 404,
    })

    await integrationOpenaiCompatibleService.updateWithVerification(
      "workspace-1",
      "openai-compatible-1",
      {
        baseURL: " https://example.com/v1 ",
        name: "Renamed Provider",
        defaultModel: "model-b",
      },
    )

    expect(mocks.validateBaseUrl).toHaveBeenCalledWith("https://example.com/v1")
    expect(mocks.verifyProvider).not.toHaveBeenCalled()
    expect(mocks.txUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Renamed Provider",
        defaultModel: "model-b",
      }),
    )
  })
})

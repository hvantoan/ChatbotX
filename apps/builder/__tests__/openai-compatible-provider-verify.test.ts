import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  verifyOpenaiCompatibleProvider: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  verifyOpenaiCompatibleProvider: mocks.verifyOpenaiCompatibleProvider,
}))

const { verifyOpenaiCompatibleProvider } = await import(
  "@/features/integration-openai-compatible/lib"
)

describe("verifyOpenaiCompatibleProvider (builder re-export)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("re-exports verifyOpenaiCompatibleProvider from @inboxos.io/business", async () => {
    mocks.verifyOpenaiCompatibleProvider.mockResolvedValueOnce({ ok: true })

    await expect(
      verifyOpenaiCompatibleProvider({
        baseURL: "https://example.com/v1",
        apiKey: "secret",
      }),
    ).resolves.toEqual({ ok: true })

    expect(mocks.verifyOpenaiCompatibleProvider).toHaveBeenCalledWith({
      baseURL: "https://example.com/v1",
      apiKey: "secret",
    })
  })
})

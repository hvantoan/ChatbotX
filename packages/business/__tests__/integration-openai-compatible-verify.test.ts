import type { NormalizedOptions } from "ky"
import { HTTPError } from "ky"
import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  validateBaseUrl: vi.fn(async (baseURL: string) => baseURL.trim()),
}))

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>()
  return {
    ...actual,
    default: { get: mocks.get },
  }
})

vi.mock("../src/integration-openai-compatible/validate-base-url", () => ({
  validateOpenaiCompatibleBaseUrlForEnvironment: mocks.validateBaseUrl,
}))

const { InboxOSException } = await import("../src/errors")
const { verifyOpenaiCompatibleProvider } = await import(
  "../src/integration-openai-compatible/verify"
)

const fakeRequest = new Request("https://example.com/v1/models")
const fakeOptions = {} as unknown as NormalizedOptions

describe("verifyOpenaiCompatibleProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateBaseUrl.mockImplementation(async (baseURL: string) =>
      baseURL.trim(),
    )
    mocks.get.mockResolvedValue(new Response(null, { status: 200 }))
  })

  test("blocks unsafe base URLs before calling the provider", async () => {
    mocks.validateBaseUrl.mockRejectedValue(
      new InboxOSException(
        "OpenAI-compatible base URL is not allowed.",
        "ssrfBlocked",
        400,
      ),
    )

    await expect(
      verifyOpenaiCompatibleProvider({
        baseURL: "http://127.0.0.1:1234/v1",
        apiKey: "secret",
      }),
    ).resolves.toEqual({ ok: false, reason: "unsafe_base_url" })
    expect(mocks.get).not.toHaveBeenCalled()
  })

  test("uses the normalized URL and manual redirects when requesting /models", async () => {
    mocks.validateBaseUrl.mockResolvedValue("https://example.com/v1")

    await expect(
      verifyOpenaiCompatibleProvider({
        baseURL: " https://example.com/v1 ",
        apiKey: "secret",
      }),
    ).resolves.toEqual({ ok: true })

    expect(mocks.get).toHaveBeenCalledWith(
      new URL("https://example.com/v1/models"),
      expect.objectContaining({
        headers: { Authorization: "Bearer secret" },
        redirect: "manual",
      }),
    )
  })

  test("treats 3xx redirect responses (both HTTPError and raw Response) as unsafe", async () => {
    mocks.get.mockRejectedValueOnce(
      new HTTPError(
        Response.redirect("http://169.254.169.254/latest/meta-data", 302),
        fakeRequest,
        fakeOptions,
      ),
    )
    await expect(
      verifyOpenaiCompatibleProvider({
        baseURL: "https://example.com/v1",
        apiKey: "secret",
      }),
    ).resolves.toEqual({ ok: false, reason: "unsafe_base_url" })

    mocks.get.mockResolvedValueOnce(
      Response.redirect("http://169.254.169.254/latest/meta-data", 302),
    )
    await expect(
      verifyOpenaiCompatibleProvider({
        baseURL: "https://example.com/v1",
        apiKey: "secret",
      }),
    ).resolves.toEqual({ ok: false, reason: "unsafe_base_url" })
  })

  test("returns unauthorized on HTTP 401/403", async () => {
    mocks.get.mockRejectedValueOnce(
      new HTTPError(
        new Response(null, { status: 401 }),
        fakeRequest,
        fakeOptions,
      ),
    )

    await expect(
      verifyOpenaiCompatibleProvider({
        baseURL: "https://example.com/v1",
        apiKey: "bad-key",
      }),
    ).resolves.toEqual({ ok: false, reason: "unauthorized", status: 401 })
  })

  test("fails closed with unreachable on HTTP 404, 5xx, or network failure", async () => {
    mocks.get.mockRejectedValueOnce(
      new HTTPError(
        new Response(null, { status: 404 }),
        fakeRequest,
        fakeOptions,
      ),
    )
    await expect(
      verifyOpenaiCompatibleProvider({
        baseURL: "https://example.com/v11",
        apiKey: "secret",
      }),
    ).resolves.toEqual({ ok: false, reason: "unreachable", status: 404 })

    mocks.get.mockResolvedValueOnce(new Response(null, { status: 502 }))
    await expect(
      verifyOpenaiCompatibleProvider({
        baseURL: "https://example.com/v1",
        apiKey: "secret",
      }),
    ).resolves.toEqual({ ok: false, reason: "unreachable", status: 502 })

    mocks.get.mockRejectedValueOnce(new TypeError("fetch failed"))
    await expect(
      verifyOpenaiCompatibleProvider({
        baseURL: "https://example.com/v1",
        apiKey: "secret",
      }),
    ).resolves.toEqual({ ok: false, reason: "unreachable" })
  })
})

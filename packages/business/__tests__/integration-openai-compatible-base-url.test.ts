import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  allowPrivateOpenaiCompatibleUrls: vi.fn(() => false),
  assertPublicUrl: vi.fn(async () => undefined),
  isCloud: vi.fn(() => true),
}))

vi.mock("../src/keys", () => ({
  allowPrivateOpenaiCompatibleUrls: mocks.allowPrivateOpenaiCompatibleUrls,
  isCloud: mocks.isCloud,
}))

vi.mock("../src/net", () => ({
  assertPublicUrl: mocks.assertPublicUrl,
}))

const {
  normalizeOpenaiCompatibleBaseUrl,
  validateOpenaiCompatibleBaseUrlForEnvironment,
} = await import("../src/integration-openai-compatible/validate-base-url")

describe("OpenAI-compatible base URL validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isCloud.mockReturnValue(true)
    mocks.allowPrivateOpenaiCompatibleUrls.mockReturnValue(false)
    mocks.assertPublicUrl.mockResolvedValue(undefined)
  })

  test("normalizes trimmed HTTP and HTTPS URLs", () => {
    expect(normalizeOpenaiCompatibleBaseUrl(" https://example.com/v1 ")).toBe(
      "https://example.com/v1",
    )
    expect(normalizeOpenaiCompatibleBaseUrl("http://127.0.0.1:1234/v1")).toBe(
      "http://127.0.0.1:1234/v1",
    )
  })

  test("rejects invalid, non-http, credential-bearing, and oversized URLs", () => {
    expect(() => normalizeOpenaiCompatibleBaseUrl("")).toThrow(
      "OpenAI-compatible base URL is invalid.",
    )
    expect(() => normalizeOpenaiCompatibleBaseUrl("ftp://example.com")).toThrow(
      "OpenAI-compatible base URL is invalid.",
    )
    expect(() =>
      normalizeOpenaiCompatibleBaseUrl("https://user:pass@example.com/v1"),
    ).toThrow("OpenAI-compatible base URL is invalid.")
    expect(() =>
      normalizeOpenaiCompatibleBaseUrl(
        `https://example.com/${"a".repeat(2049)}`,
      ),
    ).toThrow("OpenAI-compatible base URL is invalid.")
  })

  test("blocks unsafe URLs in cloud mode even when opt-out env is enabled", async () => {
    mocks.isCloud.mockReturnValue(true)
    mocks.allowPrivateOpenaiCompatibleUrls.mockReturnValue(true)
    mocks.assertPublicUrl.mockRejectedValue(new Error("private"))

    await expect(
      validateOpenaiCompatibleBaseUrlForEnvironment("http://127.0.0.1:1234/v1"),
    ).rejects.toMatchObject({
      code: "ssrfBlocked",
      httpStatusCode: 400,
    })
    expect(mocks.assertPublicUrl).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/v1",
      "OpenAI-compatible base URL",
    )
  })

  test("blocks private URLs in self-host mode by default", async () => {
    mocks.isCloud.mockReturnValue(false)
    mocks.allowPrivateOpenaiCompatibleUrls.mockReturnValue(false)
    mocks.assertPublicUrl.mockRejectedValue(new Error("private"))

    await expect(
      validateOpenaiCompatibleBaseUrlForEnvironment("http://127.0.0.1:1234/v1"),
    ).rejects.toMatchObject({
      code: "ssrfBlocked",
      httpStatusCode: 400,
    })
    expect(mocks.assertPublicUrl).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/v1",
      "OpenAI-compatible base URL",
    )
  })

  test("allows private URLs in self-host mode when opt-out env is enabled", async () => {
    mocks.isCloud.mockReturnValue(false)
    mocks.allowPrivateOpenaiCompatibleUrls.mockReturnValue(true)

    await expect(
      validateOpenaiCompatibleBaseUrlForEnvironment("http://127.0.0.1:1234/v1"),
    ).resolves.toBe("http://127.0.0.1:1234/v1")
    expect(mocks.assertPublicUrl).not.toHaveBeenCalled()
  })
})

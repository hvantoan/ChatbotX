import { afterEach, describe, expect, test, vi } from "vitest"
import { applyLegacyEnvAliases } from "../src/env-alias"

const asEnv = (value: Record<string, string>) => value as NodeJS.ProcessEnv

afterEach(() => {
  vi.restoreAllMocks()
})

describe("applyLegacyEnvAliases", () => {
  test("copies a legacy variable onto its new name", () => {
    vi.spyOn(console, "error").mockReturnValue(undefined)
    const source = asEnv({ CHATBOTX_API_KEY: "k" })

    applyLegacyEnvAliases(source)

    expect(source.INBOXOS_API_KEY).toBe("k")
    expect(source.CHATBOTX_API_KEY).toBe("k")
  })

  test("does not overwrite a new name that is already set", () => {
    vi.spyOn(console, "error").mockReturnValue(undefined)
    const source = asEnv({ CHATBOTX_API_KEY: "old", INBOXOS_API_KEY: "new" })

    applyLegacyEnvAliases(source)

    expect(source.INBOXOS_API_KEY).toBe("new")
  })

  test("warns once and names the variables it honoured", () => {
    const warnings = vi.spyOn(console, "error").mockReturnValue(undefined)

    applyLegacyEnvAliases(
      asEnv({ CHATBOTX_API_URL: "u", CHATBOTX_API_KEY: "k" }),
    )

    expect(warnings).toHaveBeenCalledTimes(1)
    expect(String(warnings.mock.calls[0]?.[0])).toContain("CHATBOTX_API_URL")
    expect(String(warnings.mock.calls[0]?.[0])).toContain("CHATBOTX_API_KEY")
  })

  test("is silent when nothing needs aliasing", () => {
    const warnings = vi.spyOn(console, "error").mockReturnValue(undefined)
    const source = asEnv({ INBOXOS_API_KEY: "k" })

    applyLegacyEnvAliases(source)

    expect(warnings).not.toHaveBeenCalled()
    expect(source).toEqual({ INBOXOS_API_KEY: "k" })
  })
})

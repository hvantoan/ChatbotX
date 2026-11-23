import { encryptUtils } from "@chatbotx.io/encryption"
import { AuthType, secretTextAuthSchema } from "@chatbotx.io/sdk"
import { describe, expect, test } from "vitest"
import {
  aiProviderAuthAad,
  classifyAiAuth,
  encryptAiProviderAuth,
} from "../scripts/backfill-ai-provider-auth/auth-codec"
import {
  AI_PROVIDER_TABLES,
  planAiAuthEncryption,
} from "../scripts/backfill-ai-provider-auth/index"

const plaintextAuth = {
  authType: AuthType.secretText,
  secretText: "sk-test-0123456789",
}

describe("backfill AI provider auth", () => {
  test("covers every AI provider table exactly once", () => {
    expect(AI_PROVIDER_TABLES).toHaveLength(7)
    expect(new Set(AI_PROVIDER_TABLES.map((entry) => entry.table)).size).toBe(7)
    expect(AI_PROVIDER_TABLES.map((entry) => entry.provider)).toEqual([
      "openai",
      "claude",
      "gemini",
      "deepseek",
      "muse",
      "openrouter",
      "openaiCompatible",
    ])
  })

  test("classifies plaintext, ciphertext, and non-secret auth", async () => {
    expect(classifyAiAuth(plaintextAuth)).toBe("plaintext")
    expect(classifyAiAuth(null)).toBe("skip")
    expect(classifyAiAuth({})).toBe("skip")
    expect(classifyAiAuth({ authType: AuthType.oauth2 })).toBe("skip")

    const blob = await encryptAiProviderAuth("openai", "ws-1", plaintextAuth)
    expect(classifyAiAuth(blob)).toBe("already-encrypted")
  })

  test("round-trips through the business reader's AAD", async () => {
    const blob = await encryptAiProviderAuth("gemini", "ws-42", plaintextAuth)
    const decrypted = await encryptUtils.decryptObject(
      blob,
      secretTextAuthSchema,
      aiProviderAuthAad("gemini", "ws-42"),
    )
    expect(decrypted).toEqual(plaintextAuth)

    await expect(
      encryptUtils.decryptObject(
        blob,
        secretTextAuthSchema,
        aiProviderAuthAad("gemini", "ws-other"),
      ),
    ).rejects.toThrow()
    await expect(
      encryptUtils.decryptObject(
        blob,
        secretTextAuthSchema,
        aiProviderAuthAad("openai", "ws-42"),
      ),
    ).rejects.toThrow()
  })

  test("is idempotent: a written row is never encrypted twice", async () => {
    const first = await planAiAuthEncryption(
      { auth: plaintextAuth, encryptedAuth: null },
      "claude",
      "ws-7",
    )
    expect(first.action).toBe("encrypt")

    const second = await planAiAuthEncryption(
      {
        auth: {},
        encryptedAuth: first.action === "encrypt" ? first.encryptedAuth : null,
      },
      "claude",
      "ws-7",
    )
    expect(second).toEqual({ action: "skip", reason: "already-encrypted" })

    const nonSecret = await planAiAuthEncryption(
      { auth: {}, encryptedAuth: null },
      "claude",
      "ws-7",
    )
    expect(nonSecret).toEqual({ action: "skip", reason: "skip" })
  })
})

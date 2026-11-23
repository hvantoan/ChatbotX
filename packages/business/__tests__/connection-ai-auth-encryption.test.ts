import type { DatabaseClient } from "@chatbotx.io/database/client"
import { encryptUtils } from "@chatbotx.io/encryption"
import { AuthType, authValueSchema } from "@chatbotx.io/sdk"
import { describe, expect, test } from "vitest"
import { CONNECTION_STORE_BINDINGS } from "../src/connection/store-bindings"

const plaintextAuth = {
  authType: AuthType.secretText,
  secretText: "sk-test-0123456789",
}

const aad = (provider: string, workspaceId: string) =>
  `ai-provider:${provider}:${workspaceId}`

const decryptWith = (blob: unknown, provider: string, workspaceId: string) =>
  encryptUtils.decryptObject(
    blob as never,
    authValueSchema,
    aad(provider, workspaceId),
  )

const captureInsert = () => {
  let captured: Record<string, unknown> = {}
  const tx = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        captured = values
        return { returning: async () => [{ id: "row-1" }] }
      },
    }),
  } as unknown as DatabaseClient
  return {
    tx,
    values: () => captured,
  }
}

const selectRow = (row: Record<string, unknown>) =>
  ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [row] }),
      }),
    }),
  }) as unknown as DatabaseClient

const captureUpdate = () => {
  let captured: Record<string, unknown> = {}
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        captured = values
        return { where: () => ({ returning: async () => [{ id: "row-1" }] }) }
      },
    }),
  } as unknown as DatabaseClient
  return {
    tx,
    values: () => captured,
  }
}

const aiProviderBindings = [
  "openai",
  "claude",
  "gemini",
  "deepseek",
  "muse",
  "openrouter",
  "openaiCompatible",
] as const

describe("AI provider connection bindings — encryptedAuth", () => {
  test.each(
    aiProviderBindings,
  )("%s writes ciphertext into encryptedAuth and blanks auth", async (provider) => {
    const binding = CONNECTION_STORE_BINDINGS[provider]
    if (!binding) {
      throw new Error(`No store binding registered for ${provider}`)
    }
    const { tx, values } = captureInsert()

    await binding.insertRow(
      {
        kind: "integration",
        workspaceId: "ws-1",
        auth: plaintextAuth,
        descriptor: { sourceId: "source-1", displayName: "Provider" },
        config: {},
      },
      tx,
    )

    const written = values()
    expect(written.auth).toEqual({})
    expect(classifyCiphertext(written.encryptedAuth)).toBe(true)
    expect(await decryptWith(written.encryptedAuth, provider, "ws-1")).toEqual(
      plaintextAuth,
    )
  })

  test("saveAuthByForeignKey re-encrypts instead of writing plaintext auth", async () => {
    const binding = CONNECTION_STORE_BINDINGS.openai
    if (!binding) {
      throw new Error("No store binding registered for openai")
    }
    const { tx, values } = captureUpdate()

    await binding.saveAuthByForeignKey(
      "integration-1",
      "ws-1",
      plaintextAuth,
      { model: "gpt-5.4-mini" },
      tx,
    )

    const written = values()
    expect(written.auth).toEqual({})
    expect(written.model).toBe("gpt-5.4-mini")
    expect(await decryptWith(written.encryptedAuth, "openai", "ws-1")).toEqual(
      plaintextAuth,
    )
  })

  test("loadAuthByForeignKey prefers the ciphertext", async () => {
    const binding = CONNECTION_STORE_BINDINGS.openai
    if (!binding) {
      throw new Error("No store binding registered for openai")
    }
    const encryptedAuth = await encryptUtils.encryptObject(
      plaintextAuth,
      aad("openai", "ws-1"),
    )

    const auth = await binding.loadAuthByForeignKey(
      "integration-1",
      "ws-1",
      selectRow({ auth: {}, encryptedAuth }),
    )

    expect(auth).toEqual(plaintextAuth)
  })

  test("loadAuthByForeignKey falls back to a pre-backfill plaintext auth", async () => {
    const binding = CONNECTION_STORE_BINDINGS.openai
    if (!binding) {
      throw new Error("No store binding registered for openai")
    }

    const auth = await binding.loadAuthByForeignKey(
      "integration-1",
      "ws-1",
      selectRow({ auth: plaintextAuth, encryptedAuth: null }),
    )

    expect(auth).toEqual(plaintextAuth)
  })

  test("loadAuthByForeignKey honours a plaintext write that raced ciphertext (rolling deploy)", async () => {
    const binding = CONNECTION_STORE_BINDINGS.openai
    if (!binding) {
      throw new Error("No store binding registered for openai")
    }
    // A pre-upgrade writer replaced the key but could not touch
    // `encryptedAuth` — the ciphertext now holds the OLD key while the
    // plaintext holds the one the user actually saved.
    const staleCiphertext = await encryptUtils.encryptObject(
      { authType: AuthType.secretText, secretText: "sk-OLD-replaced" },
      aad("openai", "ws-1"),
    )

    const auth = await binding.loadAuthByForeignKey(
      "integration-1",
      "ws-1",
      selectRow({ auth: plaintextAuth, encryptedAuth: staleCiphertext }),
    )

    expect(auth).toEqual(plaintextAuth)
  })

  test("openaiCompatible still hydrates baseURL alongside the decrypted auth", async () => {
    const binding = CONNECTION_STORE_BINDINGS.openaiCompatible
    if (!binding) {
      throw new Error("No store binding registered for openaiCompatible")
    }
    const encryptedAuth = await encryptUtils.encryptObject(
      plaintextAuth,
      aad("openaiCompatible", "ws-1"),
    )

    const auth = await binding.loadAuthByForeignKey(
      "integration-1",
      "ws-1",
      selectRow({
        auth: {},
        encryptedAuth,
        baseURL: "https://api.example.com/v1",
      }),
    )

    expect(auth).toEqual({
      ...plaintextAuth,
      baseURL: "https://api.example.com/v1",
    })
  })
})

const classifyCiphertext = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "iv" in value &&
  "tag" in value &&
  "text" in value

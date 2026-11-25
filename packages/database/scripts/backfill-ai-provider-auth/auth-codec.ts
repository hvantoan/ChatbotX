import type { EncryptedData } from "@inboxos.io/encryption"
import { encryptedDataSchema, encryptUtils } from "@inboxos.io/encryption"
import { secretTextAuthSchema } from "@inboxos.io/sdk"

export const aiProviderAuthAad = (provider: string, workspaceId: string) =>
  `ai-provider:${provider}:${workspaceId}`

export type AiAuthClassification = "plaintext" | "already-encrypted" | "skip"

export const classifyAiAuth = (auth: unknown): AiAuthClassification => {
  if (auth === null || auth === undefined) {
    return "skip"
  }
  if (encryptedDataSchema.safeParse(auth).success) {
    return "already-encrypted"
  }
  return secretTextAuthSchema.safeParse(auth).success ? "plaintext" : "skip"
}

export const encryptAiProviderAuth = (
  provider: string,
  workspaceId: string,
  auth: unknown,
): Promise<EncryptedData> =>
  encryptUtils.encryptObject(auth, aiProviderAuthAad(provider, workspaceId))

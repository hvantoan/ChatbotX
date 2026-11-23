import type { EncryptedData } from "@chatbotx.io/encryption"
import { encryptedDataSchema, encryptUtils } from "@chatbotx.io/encryption"
import { type AuthValue, authValueSchema, SdkException } from "@chatbotx.io/sdk"

export const aiProviderAuthAad = (provider: string, workspaceId: string) =>
  `ai-provider:${provider}:${workspaceId}`

export const encryptAiProviderAuth = (
  props: { provider: string; workspaceId: string },
  auth: AuthValue,
): Promise<EncryptedData> =>
  encryptUtils.encryptObject(
    auth,
    aiProviderAuthAad(props.provider, props.workspaceId),
  )

const asAuthValue = (value: unknown): AuthValue => {
  const parsedAuth = authValueSchema.safeParse(value)
  if (!parsedAuth.success) {
    throw new SdkException("Stored connection auth is invalid")
  }
  return parsedAuth.data
}

export type AiProviderAuthRow = {
  provider: string
  workspaceId: string
  auth: unknown
  encryptedAuth?: unknown
}

export const resolveAiProviderAuth = async (
  row: AiProviderAuthRow,
): Promise<AuthValue> => {
  // A parseable plaintext `auth` is always the NEWER write: every writer
  // that stores ciphertext blanks `auth` in the same statement, so a valid
  // plaintext value next to ciphertext can only come from a pre-upgrade
  // writer updating the row during a rolling deploy. Honour it — a key
  // replacement that reported success must not be silently shadowed by stale
  // ciphertext — and the row stays readable even if that ciphertext's key is
  // rotated away before the next write re-encrypts it.
  const plaintext = authValueSchema.safeParse(row.auth)
  if (plaintext.success) {
    return plaintext.data
  }
  if (row.encryptedAuth === null || row.encryptedAuth === undefined) {
    return asAuthValue(row.auth)
  }
  return await encryptUtils.decryptObject(
    encryptedDataSchema.parse(row.encryptedAuth),
    authValueSchema,
    aiProviderAuthAad(row.provider, row.workspaceId),
  )
}

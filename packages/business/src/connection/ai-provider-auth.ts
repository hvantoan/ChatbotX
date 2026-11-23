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
  if (row.encryptedAuth === null || row.encryptedAuth === undefined) {
    return asAuthValue(row.auth)
  }
  return await encryptUtils.decryptObject(
    encryptedDataSchema.parse(row.encryptedAuth),
    authValueSchema,
    aiProviderAuthAad(row.provider, row.workspaceId),
  )
}

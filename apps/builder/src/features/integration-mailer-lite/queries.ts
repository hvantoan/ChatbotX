import { integrationMailerLiteService } from "@inboxos.io/business"
import { encryptedDataSchema, encryptUtils } from "@inboxos.io/encryption"
import { mailerLiteAuthSchema } from "@inboxos.io/integration-mailer-lite"

export const getMailerLiteAuth = async (workspaceId: string) => {
  const row =
    await integrationMailerLiteService.findByWorkspaceIdOrFail(workspaceId)
  const auth = await encryptUtils.decryptObject(
    encryptedDataSchema.parse(row.auth),
    mailerLiteAuthSchema,
  )
  return { auth, row }
}

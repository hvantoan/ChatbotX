import { integrationMailchimpService } from "@inboxos.io/business"
import { encryptedDataSchema, encryptUtils } from "@inboxos.io/encryption"
import { mailchimpAuthSchema } from "@inboxos.io/integration-mailchimp"

export const getMailchimpAuth = async (workspaceId: string) => {
  const row =
    await integrationMailchimpService.findByWorkspaceIdOrFail(workspaceId)
  const auth = await encryptUtils.decryptObject(
    encryptedDataSchema.parse(row.auth),
    mailchimpAuthSchema,
  )
  return { auth, row }
}

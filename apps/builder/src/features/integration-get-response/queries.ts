import { integrationGetResponseService } from "@inboxos.io/business"
import { encryptedDataSchema, encryptUtils } from "@inboxos.io/encryption"
import { getResponseAuthSchema } from "@inboxos.io/integration-get-response"

export const getGetResponseAuth = async (workspaceId: string) => {
  const row =
    await integrationGetResponseService.findByWorkspaceIdOrFail(workspaceId)
  const auth = await encryptUtils.decryptObject(
    encryptedDataSchema.parse(row.auth),
    getResponseAuthSchema,
  )
  return { auth, row }
}

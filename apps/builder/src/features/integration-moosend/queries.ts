import { integrationMoosendService } from "@inboxos.io/business"
import { encryptedDataSchema, encryptUtils } from "@inboxos.io/encryption"
import { moosendAuthSchema } from "@inboxos.io/integration-moosend"

export const getMoosendAuth = async (workspaceId: string) => {
  const row = await integrationMoosendService.findByWorkspaceId(workspaceId)
  if (!row) {
    return null
  }
  const auth = await encryptUtils.decryptObject(
    encryptedDataSchema.parse(row.auth),
    moosendAuthSchema,
  )
  return { auth, row }
}

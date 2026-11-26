import { fileService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import {
  fileContextTypes,
  importTypes,
  uploadTypes,
} from "@inboxos.io/database/partials"
import { uploader } from "@inboxos.io/filesystem"
import { getUploadHandler } from "@/lib/upload/handlers"

export async function createPublicCouponImportUpload(input: {
  workspaceId: string
  ownerId: string
  fileName: string
  mimeType: "text/csv"
}) {
  const handler = getUploadHandler(uploadTypes.enum.import)
  const result = handler({
    workspaceId: input.workspaceId,
    userId: input.ownerId,
    fileName: input.fileName,
    mimeType: input.mimeType,
    subType: importTypes.enum.coupons,
  })

  if (!result.ok) {
    throw new InboxOSException(result.error, "couponImportUnsupportedFile")
  }

  const uploadUrl = await uploader.getPresignedUpload(result.path)
  const file = await fileService.createPending({
    workspaceId: input.workspaceId,
    userId: input.ownerId,
    contextType: fileContextTypes.enum.import,
    subType: importTypes.enum.coupons,
    path: result.path,
    fileName: input.fileName,
    mimeType: input.mimeType,
  })

  return { fileId: file.id, uploadUrl }
}

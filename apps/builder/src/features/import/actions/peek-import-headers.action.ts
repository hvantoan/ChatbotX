"use server"

import { InboxOSException } from "@inboxos.io/business/errors"
import {
  importHeaderPeekErrorCodes,
  peekImportHeaders,
} from "@inboxos.io/business/import"
import { zodBigintAsString } from "@inboxos.io/utils"
import { getTranslations } from "next-intl/server"
import { z } from "zod"
import { workspaceActionClient } from "@/lib/safe-action"

const request = z.object({ fileId: zodBigintAsString() })

export const peekImportHeadersAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString()])
  .inputSchema(request)
  .action(async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) => {
    try {
      return await peekImportHeaders({
        workspaceId,
        fileId: parsedInput.fileId,
      })
    } catch (error) {
      // The shared service speaks English + codes; the UI shows its own copy.
      if (!(error instanceof InboxOSException)) {
        throw error
      }
      const t = await getTranslations("fields.import")
      switch (error.code) {
        case importHeaderPeekErrorCodes.unableToReadHeaders:
          throw new InboxOSException(t("unableToReadHeaders"))
        case importHeaderPeekErrorCodes.unsupportedFileType:
          throw new InboxOSException(t("unsupportedFileType"))
        case importHeaderPeekErrorCodes.fileTooLarge:
          throw new InboxOSException(
            t("fileTooLarge", { size: error.data?.size ?? 0 }),
          )
        default:
          throw error
      }
    }
  })

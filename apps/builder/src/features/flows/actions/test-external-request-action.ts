"use server"

import { externalRequestService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { externalRequestFieldsSchema } from "@inboxos.io/flow-config"
import { getTranslations } from "next-intl/server"
import {
  type WorkspaceIdRequestParams,
  workspaceIdrequestParams,
} from "@/features/common/schema"
import { logger } from "@/lib/log"
import { workspaceActionClient } from "@/lib/safe-action"

export const testExternalRequestAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(externalRequestFieldsSchema)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
    }: {
      bindArgsParsedInputs: WorkspaceIdRequestParams
      parsedInput: typeof externalRequestFieldsSchema._output
    }) => {
      const t = await getTranslations("flows.externalRequest.errors")

      try {
        const result = await externalRequestService.execute(parsedInput, {
          workspaceId,
        })

        return {
          statusCode: result.statusCode,
          durationMs: result.durationMs,
          responseBody: result.responseBody,
        }
      } catch (err) {
        if (err instanceof InboxOSException) {
          throw err
        }

        logger.error({ err, workspaceId }, "External request test failed")
        throw new InboxOSException(t("requestFailed"), "externalRequestFailed")
      }
    },
  )

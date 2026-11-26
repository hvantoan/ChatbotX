"use server"

import { webhookService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { folderTypes } from "@inboxos.io/database/partials"
import { getTranslations } from "next-intl/server"
import {
  type WorkspaceIdRequestParams,
  workspaceIdrequestParams,
} from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  type CreateWebhookSchema,
  createWebhookSchema,
} from "../schema/create-webhook-schema"

export const createWebhookAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(createWebhookSchema)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
    }: {
      bindArgsParsedInputs: WorkspaceIdRequestParams
      parsedInput: CreateWebhookSchema
    }) => {
      try {
        return await webhookService.create({
          workspaceId,
          data: parsedInput,
          folderType: folderTypes.enum.webhook,
        })
      } catch (error) {
        if (
          error instanceof InboxOSException &&
          error.code === "validation" &&
          error.data
        ) {
          const t = await getTranslations()
          throw new InboxOSException(t(error.message, error.data))
        }
        throw error
      }
    },
  )

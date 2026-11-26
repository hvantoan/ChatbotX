"use server"

import { aiProviders } from "@inboxos.io/ai"
import { aiIntegrationService } from "@inboxos.io/ai/server"
import { integrationOpenRouterService } from "@inboxos.io/business"
import {
  type WorkspaceIdRequestParams,
  workspaceIdrequestParams,
} from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  type UpdateOpenRouterRequest,
  updateOpenRouterRequest,
} from "../schema/request"

export const updateIntegrationOpenRouterAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(updateOpenRouterRequest)
  .action(
    async ({
      parsedInput,
      bindArgsParsedInputs: [workspaceId],
    }: {
      parsedInput: UpdateOpenRouterRequest
      bindArgsParsedInputs: WorkspaceIdRequestParams
    }) => {
      await integrationOpenRouterService.update(workspaceId, parsedInput)

      await aiIntegrationService.invalidateCache(
        workspaceId,
        aiProviders.enum.openrouter,
      )
    },
  )

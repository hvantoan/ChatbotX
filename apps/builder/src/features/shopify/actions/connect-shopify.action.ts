"use server"

import { shopifyIntegrationService } from "@inboxos.io/business"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { connectShopifyRequest } from "../schema/public"

/** The same connect `shopify.connect` makes. */
export const connectShopifyAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(connectShopifyRequest)
  .action(
    async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) =>
      await shopifyIntegrationService.connect({ ...parsedInput, workspaceId }),
  )

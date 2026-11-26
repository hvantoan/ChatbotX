"use server"

import { shopifyIntegrationService } from "@inboxos.io/business"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

/** The same disconnect `shopify.disconnect` makes; allowed after a trial ends. */
export const disconnectShopifyAction = workspaceActionClientAllowExpired
  .bindArgsSchemas(workspaceIdrequestParams)
  .action(async ({ bindArgsParsedInputs: [workspaceId] }) => {
    await shopifyIntegrationService.disconnect(workspaceId)
  })

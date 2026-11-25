"use server"

import { aiProviders } from "@inboxos.io/ai"
import { aiIntegrationService } from "@inboxos.io/ai/server"
import { integrationDeepSeekService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectDeepSeekAction = createDisconnectAction(
  integrationDeepSeekService,
  {
    name: "DeepSeek",
    provider: "deepseek",
    log: false,
    afterDisconnect: async (workspaceId) => {
      await aiIntegrationService.invalidateCache(
        workspaceId,
        aiProviders.enum.deepseek,
      )
    },
  },
)

"use server"

import { aiProviders } from "@inboxos.io/ai"
import { aiIntegrationService } from "@inboxos.io/ai/server"
import { integrationOpenAIService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectOpenAIAction = createDisconnectAction(
  integrationOpenAIService,
  {
    name: "OpenAI",
    provider: "openai",
    log: false,
    afterDisconnect: async (workspaceId) => {
      await aiIntegrationService.invalidateCache(
        workspaceId,
        aiProviders.enum.openai,
      )
    },
  },
)

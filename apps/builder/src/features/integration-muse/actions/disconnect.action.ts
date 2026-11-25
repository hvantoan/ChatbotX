"use server"

import { aiProviders } from "@inboxos.io/ai"
import { aiIntegrationService } from "@inboxos.io/ai/server"
import { integrationMuseService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectMuseAction = createDisconnectAction(
  integrationMuseService,
  {
    name: "Muse",
    provider: "muse",
    log: false,
    afterDisconnect: async (workspaceId) => {
      await aiIntegrationService.invalidateCache(
        workspaceId,
        aiProviders.enum.muse,
      )
    },
  },
)

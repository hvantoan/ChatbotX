"use server"

import { integrationActiveCampaignService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectActiveCampaignAction = createDisconnectAction(
  integrationActiveCampaignService,
  { name: "ActiveCampaign", provider: "activeCampaign" },
)

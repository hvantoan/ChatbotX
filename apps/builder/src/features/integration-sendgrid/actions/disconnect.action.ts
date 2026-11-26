"use server"

import { integrationSendGridService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectSendGridAction = createDisconnectAction(
  integrationSendGridService,
  { name: "SendGrid", provider: "sendGrid" },
)

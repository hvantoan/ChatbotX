"use server"

import { integrationMailerLiteService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectMailerLiteAction = createDisconnectAction(
  integrationMailerLiteService,
  { name: "MailerLite", provider: "mailerLite" },
)

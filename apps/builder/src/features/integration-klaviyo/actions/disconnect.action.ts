"use server"

import { integrationKlaviyoService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectKlaviyoAction = createDisconnectAction(
  integrationKlaviyoService,
  { name: "Klaviyo", provider: "klaviyo" },
)

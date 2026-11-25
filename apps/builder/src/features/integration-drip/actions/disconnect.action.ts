"use server"

import { integrationDripService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectDripAction = createDisconnectAction(
  integrationDripService,
  { name: "Drip", provider: "drip" },
)

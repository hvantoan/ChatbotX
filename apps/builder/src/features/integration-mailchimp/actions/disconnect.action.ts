"use server"

import { integrationMailchimpService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectMailchimpAction = createDisconnectAction(
  integrationMailchimpService,
  { name: "Mailchimp", provider: "mailchimp" },
)

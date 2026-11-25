"use server"

import { integrationGetResponseService } from "@inboxos.io/business"
import { createDisconnectAction } from "@/lib/integration-actions"

export const disconnectGetResponseAction = createDisconnectAction(
  integrationGetResponseService,
  { name: "GetResponse", provider: "getResponse" },
)

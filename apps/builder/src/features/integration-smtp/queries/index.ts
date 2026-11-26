"use server"

import { integrationSmtpService } from "@inboxos.io/business"
import { assertCurrentUserCanAccessChatbot } from "@/lib/auth/utils"
import type { IntegrationSmtpResource } from "../schema/resource"

export const listIntegrationSmtps = async (input: {
  workspaceId: string
}): Promise<{ data: IntegrationSmtpResource[] }> => {
  await assertCurrentUserCanAccessChatbot(input.workspaceId)

  const data = await integrationSmtpService.listByWorkspace(input.workspaceId)

  return { data }
}

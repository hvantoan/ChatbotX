import { integrationZaloPersonalService } from "@inboxos.io/business"
import { assertCurrentUserCanAccessChatbot } from "@/lib/auth/utils"

export const listIntegrationZaloPersonals = async (input: {
  workspaceId: string
}) => {
  await assertCurrentUserCanAccessChatbot(input.workspaceId)
  return {
    data: await integrationZaloPersonalService.listByWorkspaceId(
      input.workspaceId,
    ),
  }
}

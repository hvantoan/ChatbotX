import { aiProviders } from "@inboxos.io/ai"
import { integrationService } from "@inboxos.io/business"
import { integrationTypes as dbIntegrationTypes } from "@inboxos.io/database/partials"

export async function hasAIIntegration(workspaceId: string): Promise<boolean> {
  return await integrationService.hasIntegrationOfTypes({
    workspaceId,
    integrationTypes: [
      ...aiProviders.options,
      dbIntegrationTypes.enum.openaiCompatible,
    ],
  })
}

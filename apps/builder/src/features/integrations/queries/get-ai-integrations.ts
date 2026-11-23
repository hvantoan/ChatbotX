import { aiProviders } from "@chatbotx.io/ai"
import { integrationService } from "@chatbotx.io/business"
import { integrationTypes as dbIntegrationTypes } from "@chatbotx.io/database/partials"

export async function hasAIIntegration(workspaceId: string): Promise<boolean> {
  return await integrationService.hasIntegrationOfTypes({
    workspaceId,
    integrationTypes: [
      ...aiProviders.options,
      dbIntegrationTypes.enum.openaiCompatible,
    ],
  })
}

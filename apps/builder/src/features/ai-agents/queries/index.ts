"use server"

import { aiAgentService } from "@inboxos.io/business"
import type { AIAgentModel } from "@inboxos.io/database/types"
import type { ListAIAgentsRequest } from "@/features/ai-agents/schema/query"
import type { PaginatedResponse } from "@/features/common/schema/pagination"

export async function listAIAgents(
  input: ListAIAgentsRequest,
): Promise<PaginatedResponse<AIAgentModel>> {
  return await aiAgentService.listAIAgents(input)
}

import { apiConnectConfigSchema } from "@inboxos.io/business/integration-api/schema"
import { zodBigintAsString } from "@inboxos.io/utils"
import type { z } from "zod"

export const createApiRequest = apiConnectConfigSchema.extend({
  workspaceId: zodBigintAsString().nullish(),
})
export type CreateApiRequest = z.infer<typeof createApiRequest>

export const updateApiRequest = apiConnectConfigSchema.partial()
export type UpdateApiRequest = z.infer<typeof updateApiRequest>

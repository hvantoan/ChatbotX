import { aiMcpServerAuth } from "@inboxos.io/database/partials"
import {
  aiMCPServerModel,
  createSelectSchema,
} from "@inboxos.io/database/schema"
import { zodBigintAsString } from "@inboxos.io/utils"
import { z } from "zod"

export const aiMcpServerResource = createSelectSchema(aiMCPServerModel, {
  id: zodBigintAsString(),
  workspaceId: zodBigintAsString(),
}).extend({
  auth: aiMcpServerAuth,
  availableTools: z.record(z.string(), z.any()),
})
export type AIMcpServerResource = z.infer<typeof aiMcpServerResource>

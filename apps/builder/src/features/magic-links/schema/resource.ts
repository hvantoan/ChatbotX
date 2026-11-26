import { createSelectSchema, magicLinkModel } from "@inboxos.io/database/schema"
import { z } from "zod"

export const magicLinkResource = createSelectSchema(magicLinkModel, {
  id: z.string(),
  workspaceId: z.string(),
})
export type MagicLinkResource = z.infer<typeof magicLinkResource>

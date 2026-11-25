import { facebookLeadFieldMappingsSchema } from "@inboxos.io/database/partials"
import {
  createSelectSchema,
  facebookLeadAdsAutomationModel,
} from "@inboxos.io/database/schema"
import { z } from "zod"

export const facebookLeadAdsAutomationResource = createSelectSchema(
  facebookLeadAdsAutomationModel,
  {
    id: z.string(),
    workspaceId: z.string(),
    fieldMapping: facebookLeadFieldMappingsSchema,
  },
)
export type FacebookLeadAdsAutomationResource = z.infer<
  typeof facebookLeadAdsAutomationResource
>

import { z } from "zod"
import { zaloPersonalGroupReplyConfigSchema } from "./mutation"

export const integrationZaloPersonalResource = z.object({
  id: z.string(),
  name: z.string(),
  zaloUid: z.string(),
  avatar: z.string().nullable(),
  proxyUrl: z.string().nullable(),
  groupReplyConfig: zaloPersonalGroupReplyConfigSchema.nullable(),
  inboxId: z.string(),
  createdAt: z.coerce.date(),
})

export type IntegrationZaloPersonalResource = z.infer<
  typeof integrationZaloPersonalResource
>

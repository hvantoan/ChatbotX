import {
  createSelectSchema,
  integrationTelegramModel,
} from "@inboxos.io/database/schema"
import { zodBigintAsString } from "@inboxos.io/utils"
import type { z } from "zod"

export const integrationTelegramResource = createSelectSchema(
  integrationTelegramModel,
  {
    id: zodBigintAsString(),
    inboxId: zodBigintAsString(),
    workspaceId: zodBigintAsString(),
  },
)

export type IntegrationTelegramResource = z.infer<
  typeof integrationTelegramResource
>

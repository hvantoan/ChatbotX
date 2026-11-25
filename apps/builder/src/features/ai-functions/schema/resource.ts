import {
  aiFunctionModel,
  createSelectSchema,
} from "@inboxos.io/database/schema"
import { zodBigintAsString } from "@inboxos.io/utils/zod"

export const aiFunctionResource = createSelectSchema(aiFunctionModel, {
  id: zodBigintAsString(),
  workspaceId: zodBigintAsString(),
})

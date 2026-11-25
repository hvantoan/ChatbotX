import {
  contactNoteModel,
  createSelectSchema,
} from "@inboxos.io/database/schema"
import { zodBigintAsString } from "@inboxos.io/utils"

export const contactNoteResource = createSelectSchema(contactNoteModel, {
  id: zodBigintAsString(),
  contactId: zodBigintAsString(),
  createdById: zodBigintAsString().nullable(),
})

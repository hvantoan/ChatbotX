import {
  contactNoteModel,
  createSelectSchema,
} from "@inboxos.io/database/schema"
import type { ContactNoteModel, UserModel } from "@inboxos.io/database/types"
import z from "zod"

export const contactNoteResource = createSelectSchema(contactNoteModel, {
  id: z.string(),
  contactId: z.string(),
  createdById: z.string().nullable(),
})
export type ContactNoteResource = ContactNoteModel & {
  createdBy?: UserModel | null
}

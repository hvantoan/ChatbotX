import {
  messengerConversationStarterSchema,
  messengerPersistentMenuSchema,
  messengerPersonaSchema,
} from "@inboxos.io/database/partials"
import { zodBigintAsString } from "@inboxos.io/utils"
import z from "zod"

export const selectPageRequest = z.object({
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
})

export const updateMessengerRequest = z.object({
  welcomeFlowId: zodBigintAsString().nullable(),
  persistentMenus: z.array(messengerPersistentMenuSchema),
  personas: z.array(messengerPersonaSchema),
  conversationStarters: z.array(messengerConversationStarterSchema),
  markReadOnOutbound: z.boolean().optional(),
})

export type UpdateMessengerRequest = z.infer<typeof updateMessengerRequest>

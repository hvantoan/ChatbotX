"use server"

import { aiProviders } from "@inboxos.io/ai"
import { createAiKeyConnectAction } from "@/lib/integration-actions"
import { connectMuseSchema } from "../schema/request"

export const connectMuseAction = createAiKeyConnectAction({
  provider: aiProviders.enum.muse,
  schema: connectMuseSchema,
})

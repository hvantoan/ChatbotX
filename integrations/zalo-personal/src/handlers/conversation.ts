import type { ConversationHandlers } from "@chatbotx.io/sdk"
import type { ZaloPersonalAuthValue } from "../schema"

const sendTyping: ConversationHandlers<ZaloPersonalAuthValue>["sendTyping"] =
  async () => undefined

export const conversationHandlers = {
  sendTyping,
}

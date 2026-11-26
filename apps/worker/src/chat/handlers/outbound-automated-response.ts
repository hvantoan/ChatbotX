import { replyByOutboundAutomatedResponse } from "@inboxos.io/automated-response"
import type { ChatJobCheckOutboundAutomatedResponse } from "@inboxos.io/worker-config"

export const checkOutboundAutomatedResponse = async (
  data: ChatJobCheckOutboundAutomatedResponse["data"],
): Promise<void> => {
  await replyByOutboundAutomatedResponse(data)
}

import { botMessageAnalyticsService } from "@inboxos.io/analytics"
import type { MessageBotReceivedEventPayload } from "@inboxos.io/event-bus"

export function handleMessageBotReceived(
  payloads: MessageBotReceivedEventPayload[],
): Promise<void> {
  return botMessageAnalyticsService.recordEvents(payloads)
}

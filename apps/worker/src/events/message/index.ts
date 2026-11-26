import { messageEventBus } from "@inboxos.io/event-bus"
import { messageListeners } from "./listener"

export default {
  bus: messageEventBus,
  listeners: messageListeners,
}

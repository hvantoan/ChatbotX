import { errorLogEventBus } from "@inboxos.io/event-bus"
import { errorLogListeners } from "./listener"

export default {
  bus: errorLogEventBus,
  listeners: errorLogListeners,
}

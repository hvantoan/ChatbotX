import { getChildLogger } from "@inboxos.io/logger"

export const logger = getChildLogger("EventBus")
export const deadLetterLogger = getChildLogger("EventBus:DeadLetter")

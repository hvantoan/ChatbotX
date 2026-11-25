import { InboxOSException } from "../errors"

/**
 * Codes the builder/API map to translated messages. The exception `message`
 * is the code itself — never shown raw.
 */
export const mmDeliveryErrorCodes = [
  "mmNotFound",
  "mmInvalidState",
  "mmCampaignEnded",
  "mmGrantInvalid",
  "mmPageNotConnected",
  "mmContentLocked",
] as const

export type MmDeliveryErrorCode = (typeof mmDeliveryErrorCodes)[number]

export function mmDeliveryError(code: MmDeliveryErrorCode): InboxOSException {
  return new InboxOSException(code, code)
}

export function isMmDeliveryError(error: unknown): error is InboxOSException {
  return (
    error instanceof InboxOSException &&
    (mmDeliveryErrorCodes as readonly string[]).includes(error.code)
  )
}

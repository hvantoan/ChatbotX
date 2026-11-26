import { InboxOSException } from "../errors"

/** Why the shop is not taking an order right now. */
export type WebshopClosedReason = "orderingUnavailable" | "outsideOpenHours"

export const webshopClosedException = (
  reason: WebshopClosedReason,
  vendorName?: string,
) => {
  const error = new InboxOSException(
    reason === "outsideOpenHours"
      ? `${vendorName ? `"${vendorName}"` : "The store"} is closed right now.`
      : "The store is not taking orders right now.",
    "webshopClosed",
  )
  error.data = { reason, ...(vendorName ? { vendorName } : {}) }
  return error
}

export const webshopPreviewException = () =>
  new InboxOSException(
    "A preview link can browse the shop but not order.",
    "webshopPreviewOnly",
    403,
  )

export const webshopRatingNotAllowedException = () =>
  new InboxOSException("This order cannot be rated.", "webshopRatingNotAllowed")

export const webshopCartFullException = (maximum: number) => {
  const error = new InboxOSException(
    `A cart holds at most ${maximum} different items.`,
    "webshopCartFull",
  )
  error.data = { maximum }
  return error
}

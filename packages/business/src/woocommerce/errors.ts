import { InboxOSException } from "../errors"

export const woocommerceNotConnectedException = () =>
  new InboxOSException(
    "Connect a WooCommerce store in Ecommerce → Settings → WooCommerce first.",
    "woocommerceNotConnected",
  )

/** The store refused the REST API keys, or could not be reached as a store. */
export const woocommerceCredentialsInvalidException = (detail?: string) => {
  const error = new InboxOSException(
    `WooCommerce did not accept this connection${detail ? `: ${detail}` : "."} Check the store address and the REST API keys (Read/Write permission).`,
    "woocommerceCredentialsInvalid",
  )
  error.data = { detail: detail ?? "" }
  return error
}

export const woocommerceSyncInProgressException = () =>
  new InboxOSException(
    "A WooCommerce sync is already running. Wait for it to finish.",
    "woocommerceSyncInProgress",
    409,
  )

/** The store refused the order (out of stock, invalid coupon, …). */
export const woocommerceOrderRejectedException = (detail: string) => {
  const error = new InboxOSException(
    `WooCommerce could not place the order: ${detail}`,
    "woocommerceOrderRejected",
    422,
  )
  error.data = { detail }
  return error
}

/** A product in the cart is not on the store any more. */
export const woocommerceProductMissingException = () =>
  new InboxOSException(
    "A product in the cart is no longer sold on WooCommerce. Remove it and try again.",
    "woocommerceProductMissing",
    409,
  )

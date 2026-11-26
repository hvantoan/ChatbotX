import { InboxOSException } from "../errors"

export const shopifyNotConnectedException = () =>
  new InboxOSException(
    "Connect a Shopify store in Ecommerce → Settings → Shopify first.",
    "shopifyNotConnected",
  )

/** Shopify refused the token, secret, or client credentials. */
export const shopifyCredentialsInvalidException = (detail?: string) => {
  const error = new InboxOSException(
    `Shopify did not accept these credentials${detail ? `: ${detail}` : "."} Check the store domain and the app's token or keys, and that the app is installed with the required scopes.`,
    "shopifyCredentialsInvalid",
  )
  error.data = { detail: detail ?? "" }
  return error
}

export const shopifySyncInProgressException = () =>
  new InboxOSException(
    "A Shopify sync is already running. Wait for it to finish.",
    "shopifySyncInProgress",
    409,
  )

/** Shopify refused the order (out of stock, bad address, …). */
export const shopifyOrderRejectedException = (detail: string) => {
  const error = new InboxOSException(
    `Shopify could not place the order: ${detail}`,
    "shopifyOrderRejected",
    422,
  )
  error.data = { detail }
  return error
}

/** A product in the cart has no Shopify variant to order. */
export const shopifyVariantMissingException = () =>
  new InboxOSException(
    "A product in the cart is no longer sold on Shopify. Remove it and try again.",
    "shopifyVariantMissing",
    409,
  )

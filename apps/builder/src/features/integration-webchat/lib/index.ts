import { buildBrandingUrl } from "@inboxos.io/business/branding"
import type { ChannelType } from "@inboxos.io/database/partials"
import { isCommunity } from "@/env"

export { BRANDING_TITLE } from "@inboxos.io/business/branding"

export function getBrandingUrl(channel: ChannelType, appUrl: string) {
  return buildBrandingUrl(appUrl, channel, isCommunity())
}

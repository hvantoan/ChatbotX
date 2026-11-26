import type { ListInboxesResponse, RefConfig } from "@inboxos.io/business"
import {
  buildInboxLink,
  buildInboxProfileLink,
  isLinkableChannel,
  isProfileLinkChannel,
} from "@inboxos.io/business/utils"
import type { ChannelType } from "@inboxos.io/database/partials"
import type { InboxWithIntegrations } from "@inboxos.io/database/types"
import { useTenantSettings } from "@/features/tenant"
import { useInboxList } from "./inbox-hook"

export type InboxLink = {
  inbox: ListInboxesResponse["data"][number]
  url: string
}

/**
 * Every inbox that has an "open chat" link, paired with that link — the list
 * the Get Link dialog and the ref link chat widget both show.
 * `includeProfileLinks` adds Threads and TikTok as public profile links (no
 * ref); only the chat widget wants them, since they never start a flow.
 */
export function useInboxLinks({
  enabled,
  refConfig,
  includeProfileLinks = false,
}: {
  enabled?: boolean
  refConfig?: RefConfig
  includeProfileLinks?: boolean
}): InboxLink[] {
  const inboxes = useInboxList({ enabled })
  const { appUrl } = useTenantSettings()

  return inboxes.flatMap((inbox) => {
    const channel = inbox.channel as ChannelType
    if (isProfileLinkChannel(channel)) {
      const url = includeProfileLinks
        ? buildInboxProfileLink(inbox as InboxWithIntegrations)
        : undefined
      return url ? [{ inbox, url }] : []
    }
    if (!isLinkableChannel(channel)) {
      return []
    }
    const url = buildInboxLink(
      appUrl,
      inbox as InboxWithIntegrations,
      refConfig,
    )
    return url ? [{ inbox, url }] : []
  })
}

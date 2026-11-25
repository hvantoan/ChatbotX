import {
  tiktokIntegrationService,
  workspaceService,
} from "@inboxos.io/business"
import { auditService } from "@inboxos.io/business/audit"
import { InboxOSException } from "@inboxos.io/business/errors"
import type { TiktokCredential } from "@inboxos.io/database/partials"
import type { TiktokAuthValue } from "@inboxos.io/integration-tiktok"
import { redirect } from "next/navigation"
import { integrations } from "@/integration"
import { getGuestClientIp } from "@/lib/rate-limit/guest-rate-limit"

export async function connectTiktokHandler({
  tiktokSettings,
  workspaceId,
  userId,
  req,
  redirectUrl,
}: {
  tiktokSettings: TiktokCredential
  workspaceId: string
  userId: string
  req: Request
  redirectUrl: string
}) {
  const authValue = (await integrations.tiktok.handleRequest?.({
    config: {
      ...tiktokSettings,
      redirectUrl,
    },
    req,
  })) as TiktokAuthValue

  const openId = authValue.metadata.openId
  const displayName = authValue.metadata.displayName
  const username = authValue.metadata.username

  const { ownerId } = await workspaceService.findById({ id: workspaceId })

  try {
    const { wasCreated, integration } = await tiktokIntegrationService.connect({
      workspaceId,
      ownerId,
      openId,
      username,
      displayName,
      auth: authValue,
    })

    if (!integration) {
      return
    }

    if (wasCreated) {
      await auditService.record({
        userId,
        workspaceId,
        action: "connect",
        detail: `connected a new TikTok channel (#${integration.id})`,
        ipAddress: getGuestClientIp(req.headers),
        userAgent: req.headers.get("user-agent") ?? undefined,
      })
    } else {
      await auditService.record({
        userId,
        workspaceId,
        action: "update",
        detail: `reconnected the TikTok channel (#${integration.id})`,
        ipAddress: getGuestClientIp(req.headers),
        userAgent: req.headers.get("user-agent") ?? undefined,
      })
    }
  } catch (error) {
    if (
      error instanceof InboxOSException &&
      error.code === "channelDuplicated"
    ) {
      redirect(
        `/space/${workspaceId}/settings/channels?channel=tiktok&error=duplicated`,
      )
    }
    throw error
  }
}

import { integrationZaloPersonalService } from "@inboxos.io/business"
import {
  buildZaloPersonalWebhookUrl,
  gatewayClient,
} from "@inboxos.io/integration-zalo-personal"
import { env } from "../env"
import { logger } from "./logger"

export type ZaloPersonalSessionOutcome =
  | "running"
  | "restored"
  | "skipped"
  | "failed"

export type ZaloPersonalAccount = {
  id: string
  workspaceId: string
  zaloUid: string
}

/**
 * The Zalo Personal gateway keeps sessions in memory only, so a gateway
 * restart drops every listener while the channels still look connected: sends
 * fail with 409 and inbound messages stop. Start a session for an account the
 * gateway does not track at all.
 *
 * A session the gateway still tracks is left alone, even in "disconnected" or
 * "error": it is already reconnecting with backoff, or needs a human (expired
 * cookie, kicked by another login), and restarting it every minute would
 * hammer Zalo or kick the user's other device again.
 *
 * Shared by the restore cron and the send path. Never throws: the caller
 * counts the outcome.
 */
export async function ensureZaloPersonalSession(
  account: ZaloPersonalAccount,
): Promise<ZaloPersonalSessionOutcome> {
  const { id, workspaceId, zaloUid } = account
  try {
    const status = await gatewayClient.getAccountStatus(zaloUid)
    if (status.tracked !== false) {
      return "running"
    }

    const stored = await integrationZaloPersonalService.getDecryptedCredentials(
      { id, workspaceId },
    )
    if (!stored?.webhookSecret) {
      // Without a secret the builder rejects every webhook (fail closed), so
      // a session started now would drop all inbound messages.
      logger.warn(
        { integrationId: id, zaloUid },
        "Skipping Zalo personal session restore: credentials or webhook secret missing",
      )
      return "skipped"
    }

    const origin = new URL(
      env.NEXT_PUBLIC_BROKER_URL ?? env.NEXT_PUBLIC_BUILDER_URL,
    ).origin

    await gatewayClient.startAccount({
      integrationId: id,
      zaloUid,
      credentials: stored.credentials,
      webhookUrl: buildZaloPersonalWebhookUrl(origin, zaloUid),
      webhookSecret: stored.webhookSecret,
      ...(stored.proxyUrl ? { proxyUrl: stored.proxyUrl } : {}),
    })
    logger.info(
      { integrationId: id, zaloUid },
      "Restored Zalo personal gateway session",
    )
    return "restored"
  } catch (err) {
    logger.warn(
      { err, integrationId: id, zaloUid },
      "Failed to restore Zalo personal gateway session",
    )
    return "failed"
  }
}

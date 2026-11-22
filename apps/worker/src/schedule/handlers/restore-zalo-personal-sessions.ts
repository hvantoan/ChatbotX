import { integrationZaloPersonalService } from "@chatbotx.io/business"
import {
  buildZaloPersonalWebhookUrl,
  gatewayClient,
} from "@chatbotx.io/integration-zalo-personal"
import { distributedLock } from "@chatbotx.io/redis"
import { env } from "../../env"
import { logger } from "../../lib/logger"

const LOCK_KEY = "schedule:restore-zalo-personal-sessions"
const LOCK_TTL_SECONDS = 55

type RestoreOutcome = "running" | "restored" | "skipped" | "failed"

/**
 * The Zalo Personal gateway keeps sessions in memory only, so a gateway
 * restart drops every listener while the channels still look connected:
 * sends fail and inbound messages stop. Every minute, start a session for each
 * connected account the gateway does not track at all.
 *
 * A session the gateway still tracks is left alone, even in "disconnected" or
 * "error": it is already reconnecting with backoff, or needs a human (expired
 * cookie, kicked by another login), and restarting it every minute would
 * hammer Zalo or kick the user's other device again.
 */
export const restoreZaloPersonalSessions = async () =>
  distributedLock.runExclusive({
    key: LOCK_KEY,
    timeoutInSeconds: LOCK_TTL_SECONDS,
    fn: async () => {
      const accounts =
        await integrationZaloPersonalService.listForSessionRestore()
      const counts: Record<RestoreOutcome, number> = {
        running: 0,
        restored: 0,
        skipped: 0,
        failed: 0,
      }
      if (accounts.length === 0) {
        return counts
      }

      const origin = new URL(
        env.NEXT_PUBLIC_BROKER_URL ?? env.NEXT_PUBLIC_BUILDER_URL,
      ).origin

      for (const account of accounts) {
        const outcome = await restoreOne(account, origin)
        counts[outcome] += 1
      }

      if (counts.restored > 0 || counts.failed > 0) {
        logger.info(counts, "Zalo personal session restore finished")
      }
      return counts
    },
  })

async function restoreOne(
  account: { id: string; workspaceId: string; zaloUid: string },
  origin: string,
): Promise<RestoreOutcome> {
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

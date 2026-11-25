import { integrationZaloPersonalService } from "@inboxos.io/business"
import {
  gatewayClient,
  ZaloPersonalAPIException,
} from "@inboxos.io/integration-zalo-personal"
import { ChatJobAction, type ChatJobData } from "@inboxos.io/worker-config"
import { DelayedError, type Job } from "bullmq"
import { deferralsSoFar } from "../../lib/lock-contention-deferral"
import { logger } from "../../lib/logger"
import { ensureZaloPersonalSession } from "../../lib/zalo-personal-session"

/**
 * How long a Zalo Personal send waits for its gateway session to come back.
 * The gateway answers 409 only while it holds no live session, so the message
 * was certainly not sent and parking it can never duplicate a send. The wait
 * backs off 5s, 10s, 20s, 40s — about 75s, enough for a login (5–20s) and one
 * restore-cron cycle — then the send fails with the gateway's own message.
 */
export const ZALO_PERSONAL_SEND_DEFERRAL_POLICY = {
  maxDeferrals: 4,
  baseDelayMs: 5000,
  maxDelayMs: 40_000,
} as const

export const zaloPersonalDeferralDelayMs = (deferral: number): number =>
  Math.min(
    ZALO_PERSONAL_SEND_DEFERRAL_POLICY.baseDelayMs * 2 ** deferral,
    ZALO_PERSONAL_SEND_DEFERRAL_POLICY.maxDelayMs,
  )

type DeferrableChatJob = Pick<
  Job<ChatJobData>,
  "id" | "data" | "attemptsStarted" | "attemptsMade" | "moveToDelayed"
>

const isSessionNotConnected = (error: unknown): boolean =>
  error instanceof ZaloPersonalAPIException && error.httpStatusCode === 409

/**
 * Runs at the top of the send failure path, before any failure is recorded.
 * Restores the gateway session (without waiting for the login) and parks the
 * job, mirroring `deferSendWhileAccountReconnecting`; throws `DelayedError`
 * after parking, so the attempt leaves no Message event, sendError or retry
 * behind.
 *
 * Returns when the send should fail normally: another channel or error, an
 * errored session that needs a human (expired cookie, kicked elsewhere), or
 * the deferral budget spent.
 */
export const deferSendWhileZaloPersonalReconnects = async (
  job: DeferrableChatJob,
  token: string | undefined,
  error: unknown,
): Promise<void> => {
  if (token === undefined || !isSessionNotConnected(error)) {
    return
  }
  if (job.data.type !== ChatJobAction.sendChannelMessage) {
    return
  }
  const { contactInbox } = job.data.data
  if (contactInbox.channel !== "zalo_personal") {
    return
  }

  const deferral = deferralsSoFar(job)
  if (deferral >= ZALO_PERSONAL_SEND_DEFERRAL_POLICY.maxDeferrals) {
    logger.warn(
      { jobId: job.id, zaloUid: contactInbox.sourceId, deferral },
      "Zalo personal session still not connected after the deferral budget; failing the send",
    )
    return
  }

  try {
    const account = await integrationZaloPersonalService.findByZaloUid(
      contactInbox.sourceId,
    )
    if (!account) {
      return
    }

    const status = await gatewayClient.getAccountStatus(account.zaloUid)
    if (status.state === "error") {
      logger.warn(
        {
          jobId: job.id,
          zaloUid: account.zaloUid,
          lastError: status.lastError,
        },
        "Zalo personal session needs a human; failing the send",
      )
      return
    }

    if (status.tracked === false) {
      // Do not await the login: it takes 5–20s and this worker slot is about
      // to be freed. A concurrent start (the restore cron) joins it in the
      // gateway instead of logging in a second time.
      ensureZaloPersonalSession(account).catch(() => undefined)
    }

    const delayMs = zaloPersonalDeferralDelayMs(deferral)
    logger.info(
      { jobId: job.id, zaloUid: account.zaloUid, deferral, delayMs },
      "Zalo personal session not connected; deferring send",
    )
    await job.moveToDelayed(Date.now() + delayMs, token)
    throw new DelayedError()
  } catch (err) {
    if (err instanceof DelayedError) {
      throw err
    }
    // The lookup or the deferral itself failed: keep the send's own failure
    // path (and its recorded error) instead of losing it here.
    logger.warn(
      { err, jobId: job.id, zaloUid: contactInbox.sourceId },
      "Could not defer the Zalo personal send",
    )
  }
}

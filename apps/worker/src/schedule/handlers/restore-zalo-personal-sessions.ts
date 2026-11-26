import { integrationZaloPersonalService } from "@inboxos.io/business"
import { distributedLock } from "@inboxos.io/redis"
import { logger } from "../../lib/logger"
import {
  ensureZaloPersonalSession,
  type ZaloPersonalSessionOutcome,
} from "../../lib/zalo-personal-session"

const LOCK_KEY = "schedule:restore-zalo-personal-sessions"
const LOCK_TTL_SECONDS = 55

/**
 * Every minute, start a session for each connected Zalo Personal account the
 * gateway does not track at all (a gateway restart drops every in-memory
 * session). The per-account rules live in `ensureZaloPersonalSession`, shared
 * with the send path that restores on a 409.
 */
export const restoreZaloPersonalSessions = async () =>
  distributedLock.runExclusive({
    key: LOCK_KEY,
    timeoutInSeconds: LOCK_TTL_SECONDS,
    fn: async () => {
      const accounts =
        await integrationZaloPersonalService.listForSessionRestore()
      const counts: Record<ZaloPersonalSessionOutcome, number> = {
        running: 0,
        restored: 0,
        skipped: 0,
        failed: 0,
      }
      if (accounts.length === 0) {
        return counts
      }

      for (const account of accounts) {
        counts[await ensureZaloPersonalSession(account)] += 1
      }

      if (counts.restored > 0 || counts.failed > 0) {
        logger.info(counts, "Zalo personal session restore finished")
      }
      return counts
    },
  })

import { maintainLeaderboardPartitions as maintain } from "@inboxos.io/business/leaderboard"
import { logger } from "../../lib/logger"

// Keeps `LeaderboardScoreEvent` monthly partitions ahead of incoming data and
// drops months past retention (see `maintainLeaderboardPartitions` in
// `@inboxos.io/business/leaderboard`). System maintenance — not
// workspace-scoped, so no blocked-owner guard.
export async function maintainLeaderboardPartitions(): Promise<void> {
  try {
    await maintain()
  } catch (err) {
    logger.error({ err }, "[maintainLeaderboardPartitions] failed")
  }
}

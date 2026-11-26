import { findLeaderboardReferrerName } from "@inboxos.io/business/leaderboard"

export const getLeaderboardReferrerName = async (
  contactId: string,
  workspaceId: string,
): Promise<string | null> =>
  await findLeaderboardReferrerName({ contactId, workspaceId })

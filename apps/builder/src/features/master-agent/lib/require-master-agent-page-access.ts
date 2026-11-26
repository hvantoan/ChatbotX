import { InboxOSException } from "@inboxos.io/business/errors"
import { notFound } from "next/navigation"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"
import { canUseMasterAgent } from "./access"

/**
 * Server-side gate for the Master Agent chat page. Not a member (or signed
 * out) is a 404, the same as every other workspace page, so the page's
 * existence is not leaked; a member without `broadcasts` + `flows` gets a 403
 * instead of an empty chat that would fail on its first call.
 */
export async function requireMasterAgentPageAccess(workspaceId: string) {
  const access = await getCurrentUserAndTargetWorkspace(workspaceId)
  if (!access) {
    notFound()
  }
  if (!canUseMasterAgent(access.targetWorkspaceMember.permissions)) {
    throw new InboxOSException(
      "You need the broadcasts and flows permissions to use the Master Agent.",
      "masterAgentForbidden",
      403,
    )
  }
  return access
}

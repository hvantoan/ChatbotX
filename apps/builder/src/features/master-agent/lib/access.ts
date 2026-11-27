import { notFound } from "next/navigation"
import {
  type CurrentUserAndTargetWorkspace,
  getCurrentUserAndTargetWorkspace,
} from "@/lib/auth/utils"

/**
 * Every workspace member may open the Master Agent page: chatting executes
 * nothing by itself, and every operation the agent runs is permission-checked
 * server-side through the turn's credential. Not a member (or signed out) is
 * a 404, the same as every other workspace page, so the page's existence is
 * not leaked.
 */
export async function requireMasterAgentPageAccess(
  workspaceId: string,
): Promise<CurrentUserAndTargetWorkspace> {
  const access = await getCurrentUserAndTargetWorkspace(workspaceId)
  if (!access) {
    notFound()
  }
  return access
}

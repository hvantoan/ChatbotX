import {
  hasWorkspacePermission,
  type PermissionsInput,
} from "@/lib/auth/permission-routes"

/**
 * A Master Agent turn drafts broadcasts for a group and the draft sends a flow,
 * so a member needs BOTH the `broadcasts` section (`broadcast` flag) and flows.
 * Applied by the private API, the confirm procedure and the chat page — the
 * service does not check member permissions itself.
 */
export function canUseMasterAgent(permissions: PermissionsInput): boolean {
  return (
    hasWorkspacePermission(permissions, "broadcast") &&
    hasWorkspacePermission(permissions, "flows")
  )
}

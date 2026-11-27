import type { MasterAgentCredentialPayload } from "@inboxos.io/business"
import {
  hasWorkspacePermission,
  resolveWorkspaceAccess,
  userService,
  workspaceApiTokenService,
  workspaceMemberService,
} from "@inboxos.io/business"
import type { WorkspaceApiTokenScope } from "@inboxos.io/database/partials"
import type {
  UserModel,
  WorkspaceMemberModel,
  WorkspaceModel,
} from "@inboxos.io/database/types"
import { ORPCError } from "@orpc/server"
import { isValidWorkspaceId } from "@/lib/mobile-auth/resolve-mobile-principal"
import type { RequestApiToken } from "@/middlewares/context"

export type MasterAgentWorkspacePrincipal = {
  workspace: WorkspaceModel
  apiToken: RequestApiToken
  audit: { userId: string; source: string }
  /** Set when the turn runs as a member; absent for workspace-token turns. */
  user?: UserModel
  member?: WorkspaceMemberModel
}

const invalidTokenError = () =>
  new ORPCError("INVALID_CHATBOT_TOKEN", {
    status: 401,
    message: "Invalid or missing workspace API token",
  })

/**
 * Maps a member's permission flags onto the workspace-token scope axis, the
 * only per-operation enforcement the public API knows. `superAdmin` is the
 * unrestricted token (`null`); the other flags map onto the areas their UI
 * sections already use. `ecommerce` covers orders/products/coupons and the
 * store settings under them; `analytics` additionally grants `ads` and
 * `leaderboards`, whose data the same section reads. Areas with no member
 * permission flag at all (`media`, `settings`, `templates`, …) stay out of
 * the array — a member the workspace owner never granted a section to cannot
 * reach it through the Master Agent either.
 */
const deriveMasterAgentMemberScopes = (
  permissions: WorkspaceMemberModel["permissions"],
): WorkspaceApiTokenScope[] | null => {
  if (permissions.superAdmin === true) {
    return null
  }
  const scopes = new Set<WorkspaceApiTokenScope>()
  if (
    hasWorkspacePermission(permissions, "contacts") ||
    hasWorkspacePermission(permissions, "onlyAssignedContacts")
  ) {
    for (const scope of ["contacts", "inbox", "pipelines", "media"] as const) {
      scopes.add(scope)
    }
  }
  if (hasWorkspacePermission(permissions, "flows")) {
    scopes.add("automation")
  }
  if (hasWorkspacePermission(permissions, "broadcast")) {
    scopes.add("broadcasts")
  }
  if (hasWorkspacePermission(permissions, "ecommerce")) {
    scopes.add("ecommerce")
  }
  if (hasWorkspacePermission(permissions, "analytics")) {
    for (const scope of ["analytics", "ads", "leaderboards"] as const) {
      scopes.add(scope)
    }
  }
  return [...scopes]
}

/**
 * Resolves a verified master-agent credential into the same principal shape
 * the other branches of `workspaceTokenAuthMidddleware` produce.
 *
 * A member credential acts as that member: context carries `user`/`member`
 * (the same member-scoping switch the mobile branch uses) and the token
 * scopes are derived from the member's permission flags — including a
 * synthetic support-access membership (invariant 19), so a platform admin
 * supporting the workspace is not blocked. A token credential acts as the
 * workspace token the chat was started with, scopes and read-only mode
 * included; a token deleted since is a 401.
 */
export const resolveMasterAgentWorkspacePrincipal = async (props: {
  payload: MasterAgentCredentialPayload
  requestedWorkspaceId: string | undefined
}): Promise<MasterAgentWorkspacePrincipal> => {
  const { payload } = props

  if (
    props.requestedWorkspaceId &&
    isValidWorkspaceId(props.requestedWorkspaceId) &&
    props.requestedWorkspaceId !== payload.workspaceId
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "Credential is not valid for this workspace",
    })
  }

  if (payload.tokenId) {
    const tokenAuth = await workspaceApiTokenService.findWorkspaceAndTokenById({
      tokenId: payload.tokenId,
      workspaceId: payload.workspaceId,
    })
    if (!tokenAuth) {
      // The token was revoked or deleted after the turn started.
      throw invalidTokenError()
    }
    const { workspace, apiToken } = tokenAuth
    return {
      workspace,
      apiToken: {
        id: apiToken.id,
        workspaceId: apiToken.workspaceId,
        permission: apiToken.permission,
        scopes: apiToken.scopes,
        isDefault: apiToken.isDefault,
      },
      audit: {
        userId: workspace.ownerId,
        source: `master-agent:${payload.sessionId}`,
      },
    }
  }

  if (!payload.memberId) {
    throw invalidTokenError()
  }
  const user = await userService.findById(payload.memberId)
  if (!user || user.deletionRequestedAt) {
    throw invalidTokenError()
  }

  const realMember = await workspaceMemberService.findMembership({
    workspaceId: payload.workspaceId,
    userId: user.id,
  })
  // `resolveWorkspaceAccess` is the single membership gate (invariant 19): a
  // platform admin with support access gets their synthetic membership here,
  // never a WorkspaceMember row.
  const access = await resolveWorkspaceAccess({
    realMember,
    workspaceId: payload.workspaceId,
    user,
  })
  if (!access) {
    throw new ORPCError("FORBIDDEN", {
      message: "Account has no access to this workspace",
    })
  }

  return {
    workspace: access.workspace,
    apiToken: {
      id: `master-agent:${payload.sessionId}`,
      workspaceId: access.workspace.id,
      // Members have no read-only mode; what they may do is bounded by the
      // scopes their permission flags derive.
      permission: "full",
      scopes: deriveMasterAgentMemberScopes(access.member.permissions),
      isDefault: false,
    },
    audit: {
      userId: user.id,
      source: `master-agent:${payload.sessionId}`,
    },
    user,
    member: access.member,
  }
}

import { isSupportConsentRequired } from "@inboxos.io/business"
import { getIdFromParams } from "@inboxos.io/utils"
import { notFound } from "next/navigation"

import { UpdateWorkspaceForm } from "@/features/workspaces/update-workspace-form"
import { hasWorkspacePermission } from "@/lib/auth/permission-routes"
import { getCurrentUserAndTargetWorkspace } from "@/lib/auth/utils"

export default async function GeneralPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  const [userAndWorkspace, consentRequired] = await Promise.all([
    getCurrentUserAndTargetWorkspace(workspaceId),
    isSupportConsentRequired(),
  ])
  if (!userAndWorkspace) {
    return notFound()
  }

  return (
    <UpdateWorkspaceForm
      canManageSupportAccess={
        hasWorkspacePermission(
          userAndWorkspace.targetWorkspaceMember.permissions,
          "superAdmin",
        ) && !userAndWorkspace.isSupportSession
      }
      consentRequired={consentRequired}
      workspace={userAndWorkspace.targetWorkspace}
    />
  )
}

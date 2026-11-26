import { integrationGetResponseService } from "@inboxos.io/business"
import { getIdFromParams } from "@inboxos.io/utils"
import { notFound } from "next/navigation"
import { ManageGetResponse } from "@/features/integration-get-response/components/manage-get-response"

export default async function SettingIntegrationGetResponsePage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }
  const integration =
    await integrationGetResponseService.findByWorkspaceId(workspaceId)
  return (
    <ManageGetResponse
      isConnected={Boolean(integration)}
      workspaceId={workspaceId}
    />
  )
}

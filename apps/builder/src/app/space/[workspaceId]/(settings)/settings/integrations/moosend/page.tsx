import { integrationMoosendService } from "@inboxos.io/business"
import { getIdFromParams } from "@inboxos.io/utils"
import { notFound } from "next/navigation"
import { ManageMoosend } from "@/features/integration-moosend/components/manage-moosend"

export default async function SettingIntegrationMoosendPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }
  const integration =
    await integrationMoosendService.findByWorkspaceId(workspaceId)
  return (
    <ManageMoosend
      isConnected={Boolean(integration)}
      workspaceId={workspaceId}
    />
  )
}

import { getIdFromParams } from "@inboxos.io/utils"
import { notFound } from "next/navigation"
import { listIntegrationZaloPersonals } from "@/features/integration-zalo-personal/queries"
import { ZaloPersonalManage } from "@/features/integration-zalo-personal/zalo-personal-manage"
import { requireVisibleChannel } from "@/lib/workspace/require-visible-channel"
import { resolveChannelCreatable } from "@/lib/workspace/resolve-channel-creatable"

export default async function SettingChannelZaloPersonalPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  await requireVisibleChannel(workspaceId, "zalo_personal")

  const promises = listIntegrationZaloPersonals({ workspaceId })
  const canCreate = await resolveChannelCreatable(workspaceId, "zalo_personal")
  return (
    <ZaloPersonalManage
      canCreate={canCreate}
      promises={promises}
      workspaceId={workspaceId}
    />
  )
}

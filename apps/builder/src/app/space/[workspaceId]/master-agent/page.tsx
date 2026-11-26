import { getIdFromParams } from "@inboxos.io/utils"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { MasterAgentChat } from "@/features/master-agent/components/master-agent-chat"
import { canUseMasterAgent } from "@/features/master-agent/lib/access"
import { requireMasterAgentPageAccess } from "@/features/master-agent/lib/require-master-agent-page-access"

export default async function MasterAgentPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }
  // Server-side gate: a member without `broadcasts` + `flows` never reaches the
  // chat, and the private procedures check the same rule again.
  const access = await requireMasterAgentPageAccess(workspaceId)
  const t = await getTranslations("masterAgent")

  return (
    <div className="flex flex-col gap-4 pb-20">
      <div>
        <h1 className="font-semibold text-xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <MasterAgentChat
        canConfirm={canUseMasterAgent(access.targetWorkspaceMember.permissions)}
        workspaceId={workspaceId}
      />
    </div>
  )
}

import { masterAgentService } from "@inboxos.io/business"
import { getIdFromParams } from "@inboxos.io/utils"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { listIntegrationOpenaiCompatible } from "@/features/integration-openai-compatible/queries"
import { MasterAgentChat } from "@/features/master-agent/components/master-agent-chat"
import { MasterAgentConfigForm } from "@/features/master-agent/components/master-agent-config-form"
import { requireMasterAgentPageAccess } from "@/features/master-agent/lib/access"

export default async function MasterAgentPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }
  // Every member may open the page — see the access module for the reasoning.
  await requireMasterAgentPageAccess(workspaceId)
  const t = await getTranslations("masterAgent")

  const [config, openaiCompatibleIntegrations] = await Promise.all([
    masterAgentService.getConfigView({ workspaceId }),
    listIntegrationOpenaiCompatible({ workspaceId }),
  ])

  return (
    <div className="flex flex-col gap-8 pb-20">
      <div>
        <h1 className="font-semibold text-xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <MasterAgentChat workspaceId={workspaceId} />
      <div className="flex max-w-2xl flex-col gap-4">
        <h2 className="font-medium text-sm">{t("config.title")}</h2>
        <MasterAgentConfigForm
          initialConfig={config}
          openaiCompatibleIntegrations={openaiCompatibleIntegrations}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  )
}

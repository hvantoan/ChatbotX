"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import { RefreshCwIcon } from "lucide-react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"
import { syncZaloPersonalAction } from "../actions/sync.action"

export function ZaloPersonalSyncButton({
  integrationId,
}: {
  integrationId: string
}) {
  const t = useTranslations()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  const { execute, isPending } = useAction(
    syncZaloPersonalAction.bind(null, workspaceId, integrationId),
    {
      onSuccess: () => {
        toast.success(t("fields.zalo_personal.syncSuccess"))
      },
      onError: ({ error }) => {
        if (error.serverError) {
          toast.error(error.serverError)
        }
      },
    },
  )

  return (
    <Button
      disabled={isPending}
      onClick={() => execute()}
      size="sm"
      title={t("fields.zalo_personal.sync")}
      variant="outline"
    >
      <RefreshCwIcon
        className={isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"}
      />
      <span className="sr-only">{t("fields.zalo_personal.sync")}</span>
    </Button>
  )
}

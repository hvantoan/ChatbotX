"use client"

import { Button } from "@inboxos.io/ui/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@inboxos.io/ui/components/ui/table"
import { PlusCircleIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { use } from "react"
import { AddChannelButton } from "@/features/inboxes/components/add-channel-button"
import { ZaloPersonalConnect } from "./components/zalo-personal-connect"
import { ZaloPersonalDisconnect } from "./components/zalo-personal-disconnect"
import { ZaloPersonalSettingsDialog } from "./components/zalo-personal-settings-dialog"
import { ZaloPersonalSyncButton } from "./components/zalo-personal-sync-button"
import type { listIntegrationZaloPersonals } from "./queries"

type ZaloPersonalManageProps = {
  canCreate?: boolean
  workspaceId: string
  promises: Promise<Awaited<ReturnType<typeof listIntegrationZaloPersonals>>>
}

export function ZaloPersonalManage({
  canCreate = true,
  workspaceId,
  promises,
}: ZaloPersonalManageProps) {
  const { data: accounts } = use(promises)
  const t = useTranslations()

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end gap-2">
        <AddChannelButton
          canCreate={canCreate}
          label={t("fields.zalo_personal.label")}
          render={
            <ZaloPersonalConnect workspaceId={workspaceId}>
              <Button size="sm" variant="secondary">
                <PlusCircleIcon className="h-4 w-4" />
                {t("actions.addFeature", {
                  feature: t("fields.zalo_personal.label"),
                })}
              </Button>
            </ZaloPersonalConnect>
          }
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fields.name.label")}</TableHead>
              <TableHead>{t("fields.zalo_personal.zaloUid")}</TableHead>
              <TableHead>{t("fields.zalo_personal.groupReplyMode")}</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => (
              <TableRow key={account.id}>
                <TableCell>{account.name}</TableCell>
                <TableCell>{account.zaloUid}</TableCell>
                <TableCell>{account.groupReplyConfig?.mode ?? "all"}</TableCell>
                <TableCell className="flex w-48 justify-end gap-2">
                  <ZaloPersonalSyncButton integrationId={account.id} />
                  <ZaloPersonalSettingsDialog
                    initialGroupReplyConfig={account.groupReplyConfig}
                    initialName={account.name}
                    initialProxyUrl={account.proxyUrl}
                    integrationId={account.id}
                    workspaceId={workspaceId}
                  />
                  <ZaloPersonalDisconnect integrationId={account.id} />
                </TableCell>
              </TableRow>
            ))}
            {accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={4}>{t("analytics.noData")}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

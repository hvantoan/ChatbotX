"use client"

import type { ZaloPersonalGroupReplyConfig } from "@inboxos.io/database/schema"
import { Button } from "@inboxos.io/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@inboxos.io/ui/components/ui/dialog"
import { Input } from "@inboxos.io/ui/components/ui/input"
import { Label } from "@inboxos.io/ui/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@inboxos.io/ui/components/ui/select"
import { SettingsIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { useState } from "react"
import { toast } from "sonner"
import { updateZaloPersonalAction } from "../actions/update.action"

type ZaloPersonalSettingsDialogProps = {
  workspaceId: string
  integrationId: string
  initialName: string
  initialProxyUrl: string | null
  initialGroupReplyConfig: ZaloPersonalGroupReplyConfig | null
}

export function ZaloPersonalSettingsDialog({
  workspaceId,
  integrationId,
  initialName,
  initialProxyUrl,
  initialGroupReplyConfig,
}: ZaloPersonalSettingsDialogProps) {
  const t = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [proxyUrl, setProxyUrl] = useState(initialProxyUrl ?? "")
  const [mode, setMode] = useState<ZaloPersonalGroupReplyConfig["mode"]>(
    initialGroupReplyConfig?.mode ?? "all",
  )
  const [allowedIds, setAllowedIds] = useState(
    (initialGroupReplyConfig?.allowedGroupIds ?? []).join(", "),
  )

  const { executeAsync: updateSettings, isPending } = useAction(
    updateZaloPersonalAction.bind(null, workspaceId, integrationId),
    {
      onSuccess: () => {
        router.refresh()
        setOpen(false)
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "Failed to update settings")
      },
    },
  )

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const parsedIds = allowedIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)

    updateSettings({
      name: name.trim(),
      proxyUrl: proxyUrl.trim() || null,
      groupReplyConfig: {
        mode,
        ...(mode === "allowlist" ? { allowedGroupIds: parsedIds } : {}),
      },
    })
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <SettingsIcon className="h-4 w-4" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("fields.zalo_personal.label")}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSave}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zp-edit-name">
              {t("fields.zalo_personal.accountName")}
            </Label>
            <Input
              id="zp-edit-name"
              onChange={(e) => setName(e.target.value)}
              required
              value={name}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="zp-edit-proxy">
              {t("fields.zalo_personal.proxyUrl")}
            </Label>
            <Input
              id="zp-edit-proxy"
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder={t("fields.zalo_personal.proxyUrlPlaceholder")}
              value={proxyUrl}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("fields.zalo_personal.groupReplyMode")}</Label>
            <Select
              onValueChange={(v) =>
                setMode(v as ZaloPersonalGroupReplyConfig["mode"])
              }
              value={mode}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("fields.zalo_personal.groupReplyModeAll")}
                </SelectItem>
                <SelectItem value="mentions">
                  {t("fields.zalo_personal.groupReplyModeMentions")}
                </SelectItem>
                <SelectItem value="allowlist">
                  {t("fields.zalo_personal.groupReplyModeAllowlist")}
                </SelectItem>
                <SelectItem value="disabled">
                  {t("fields.zalo_personal.groupReplyModeDisabled")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "allowlist" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zp-allowed-groups">
                {t("fields.zalo_personal.allowedGroupIds")}
              </Label>
              <Input
                id="zp-allowed-groups"
                onChange={(e) => setAllowedIds(e.target.value)}
                placeholder={t(
                  "fields.zalo_personal.allowedGroupIdsPlaceholder",
                )}
                value={allowedIds}
              />
            </div>
          ) : null}

          <Button disabled={isPending} type="submit">
            {t("fields.zalo_personal.saveSettings")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

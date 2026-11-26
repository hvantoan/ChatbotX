"use client"

import { Button } from "@inboxos.io/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@inboxos.io/ui/components/ui/card"
import { Loader2Icon } from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import type { z } from "zod"
import { BroadcastStatusBadge } from "@/features/broadcasts/components/broadcast-status-badge"
import { REMINDER_TIMEZONE } from "../lib/reminder-timezone"
import type { masterAgentDraftResource } from "../schema/private"

export type MasterAgentDraft = z.output<typeof masterAgentDraftResource>

/**
 * One reminder the agent drafted. The only action is Confirm: it schedules the
 * draft through the private confirm procedure, which re-checks the member's
 * permissions and schedules the draft's own stored time.
 */
export function MasterAgentDraftCard({
  draft,
  canConfirm,
  isConfirming,
  onConfirm,
}: {
  draft: MasterAgentDraft
  canConfirm: boolean
  isConfirming: boolean
  onConfirm: (broadcastId: string) => void
}) {
  const t = useTranslations("masterAgent")
  const format = useFormatter()
  const isDraft = draft.status === "draft"

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="text-base">{draft.name}</CardTitle>
        <BroadcastStatusBadge
          schedulesType={draft.schedulesType}
          status={draft.status}
        />
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <div className="flex gap-2">
          <span className="text-muted-foreground">{t("fields.group")}</span>
          <span>
            {draft.group
              ? `${draft.group.name} (${draft.group.sourceId})`
              : t("fields.groupUnknown")}
          </span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">{t("fields.sendTime")}</span>
          <span>
            {format.dateTime(draft.schedulesAt, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: REMINDER_TIMEZONE,
            })}{" "}
            <span className="text-muted-foreground">
              {t("fields.timezone")}
            </span>
          </span>
        </div>
        <div className="flex gap-2">
          <span className="text-muted-foreground">{t("fields.flow")}</span>
          <span>{draft.flowId ?? t("fields.noFlow")}</span>
        </div>
      </CardContent>
      <CardFooter>
        {isDraft && !canConfirm ? (
          // A member without the broadcasts + flows permissions cannot
          // schedule anything, so the card shows no Confirm action at all.
          <span className="text-muted-foreground text-sm">
            {t("fields.missingPermission")}
          </span>
        ) : null}
        {isDraft && canConfirm ? (
          <Button
            disabled={isConfirming}
            onClick={() => onConfirm(draft.id)}
            size="sm"
            type="button"
          >
            {isConfirming ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : null}
            {t("confirm")}
          </Button>
        ) : null}
        {isDraft ? null : (
          <span className="text-muted-foreground text-sm">
            {t("confirmed")}
          </span>
        )}
      </CardFooter>
    </Card>
  )
}

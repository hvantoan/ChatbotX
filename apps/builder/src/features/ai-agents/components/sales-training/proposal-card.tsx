"use client"

import type {
  AIAgentSalesProfile,
  AIAgentTrainingProposal,
} from "@chatbotx.io/database/partials"
import { Badge } from "@chatbotx.io/ui/components/ui/badge"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  AlertTriangleIcon,
  CheckIcon,
  HelpCircleIcon,
  Loader2Icon,
  PencilIcon,
  XIcon,
} from "lucide-react"
import { useTranslations } from "next-intl"

export type ProposalCardProps = {
  proposal: AIAgentTrainingProposal
  appliedVersion?: number | null
  isApplying?: boolean
  disabled?: boolean
  productNameById?: ReadonlyMap<string, string>
  onApply?: (profile: AIAgentSalesProfile) => void
  onEdit?: (profile: AIAgentSalesProfile) => void
  onCancel?: () => void
}

function formatDiffValue(
  field: string,
  value: unknown,
  productNameById?: ReadonlyMap<string, string>,
): string {
  if (value === null || value === undefined || value === "") {
    return "—"
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false"
  }
  if (typeof value === "number" || typeof value === "string") {
    return String(value)
  }
  if (field === "targetProducts" && Array.isArray(value)) {
    if (value.length === 0) {
      return "—"
    }
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null && "productId" in item) {
          const pid = String((item as { productId: unknown }).productId)
          const prio =
            "priority" in item
              ? String((item as { priority: unknown }).priority)
              : "?"
          const note =
            "pitchNote" in item && (item as { pitchNote?: string }).pitchNote
              ? ` (${(item as { pitchNote: string }).pitchNote})`
              : ""
          const name = productNameById?.get(pid) ?? `#${pid}`
          return `[P${prio}] ${name}${note}`
        }
        return JSON.stringify(item)
      })
      .join(", ")
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(String).join(", ") : "—"
  }
  return JSON.stringify(value)
}

export function ProposalCard({
  proposal,
  appliedVersion,
  isApplying = false,
  disabled = false,
  productNameById,
  onApply,
  onEdit,
  onCancel,
}: ProposalCardProps) {
  const t = useTranslations("aiAgentSalesTraining")

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xs"
      data-testid="sales-proposal-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-sm">{t("proposal.title")}</span>
        {appliedVersion ? (
          <Badge variant="secondary">
            <CheckIcon aria-hidden className="mr-1 size-3" />
            {t("proposal.appliedBadge", { version: appliedVersion })}
          </Badge>
        ) : null}
      </div>

      {proposal.unmatchedProducts && proposal.unmatchedProducts.length > 0 ? (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-800 text-xs dark:text-amber-200"
          data-testid="proposal-unmatched-products"
        >
          <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <span className="font-medium">
              {t("proposal.unmatchedProducts")}:{" "}
            </span>
            <span>{proposal.unmatchedProducts.join(", ")}</span>
          </div>
        </div>
      ) : null}

      {proposal.clarifyingQuestion ? (
        <div
          className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 p-2.5 text-blue-800 text-xs dark:text-blue-200"
          data-testid="proposal-clarifying-question"
        >
          <HelpCircleIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{proposal.clarifyingQuestion}</span>
        </div>
      ) : null}

      {proposal.diff.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="border-border border-b bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("proposal.field")}</th>
                <th className="px-3 py-2 font-medium">
                  {t("proposal.before")}
                </th>
                <th className="px-3 py-2 font-medium">{t("proposal.after")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {proposal.diff.map((entry) => (
                <tr data-testid={`diff-row-${entry.field}`} key={entry.field}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {t(`fields.${entry.field}` as Parameters<typeof t>[0])}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDiffValue(
                      entry.field,
                      entry.before,
                      productNameById,
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {formatDiffValue(entry.field, entry.after, productNameById)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          {t("proposal.noChanges")}
        </p>
      )}

      {!appliedVersion && (onApply || onEdit || onCancel) ? (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {onCancel ? (
            <Button
              data-testid="proposal-cancel-btn"
              disabled={disabled || isApplying}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="ghost"
            >
              <XIcon aria-hidden className="size-3.5" />
              {t("proposal.cancel")}
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              data-testid="proposal-edit-btn"
              disabled={disabled || isApplying}
              onClick={() => onEdit(proposal.proposedProfile)}
              size="sm"
              type="button"
              variant="outline"
            >
              <PencilIcon aria-hidden className="size-3.5" />
              {t("proposal.edit")}
            </Button>
          ) : null}
          {onApply && proposal.diff.length > 0 ? (
            <Button
              data-testid="proposal-apply-btn"
              disabled={disabled || isApplying}
              onClick={() => onApply(proposal.proposedProfile)}
              size="sm"
              type="button"
            >
              {isApplying ? (
                <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
              ) : (
                <CheckIcon aria-hidden className="size-3.5" />
              )}
              {t("proposal.apply")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

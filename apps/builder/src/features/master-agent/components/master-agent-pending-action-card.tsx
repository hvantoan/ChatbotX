"use client"

import { Badge } from "@inboxos.io/ui/components/ui/badge"
import { Button } from "@inboxos.io/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@inboxos.io/ui/components/ui/card"
import { CheckIcon, ExternalLinkIcon, Loader2Icon, XIcon } from "lucide-react"
import Link from "next/link"
import { useTranslations } from "next-intl"

export type MasterAgentPendingActionCardData = {
  id: string
  operationId: string
  toolName: string
  args: unknown
  policy: "confirm_diff" | "confirm_outbound" | "confirm_destructive"
  currentState: unknown
  status: "pending" | "approved" | "rejected" | "expired" | "failed"
  resourcePath: string | null
}

type DecidedStatus = "approved" | "rejected" | "expired" | "failed"

const policyKeyByPolicy = {
  confirm_diff: "policy.confirm_diff",
  confirm_outbound: "policy.confirm_outbound",
  confirm_destructive: "policy.confirm_destructive",
} as const satisfies Record<MasterAgentPendingActionCardData["policy"], string>

const JsonBlock = ({ value }: { value: unknown }) => (
  <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs">
    {JSON.stringify(value, null, 2)}
  </pre>
)

/**
 * One action the agent proposed and may not run itself: the proposal and the
 * resource's current state side by side, plus the confirm/reject decision.
 * Decided actions render read-only — the decision is final by design (the
 * single-winner claim can never be re-run).
 */
export function MasterAgentPendingActionCard({
  action,
  workspaceId,
  isDeciding,
  onConfirm,
  onReject,
}: {
  action: MasterAgentPendingActionCardData
  workspaceId: string
  isDeciding: boolean
  onConfirm: (actionId: string) => void
  onReject: (actionId: string) => void
}) {
  const t = useTranslations("masterAgent")
  const pending = action.status === "pending"

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="font-mono text-sm">
            {action.operationId}
          </CardTitle>
          <Badge variant={pending ? "default" : "secondary"}>
            {pending ? t("pending") : t(action.status as DecidedStatus)}
          </Badge>
        </div>
        <p className="text-muted-foreground text-xs">
          {t(policyKeyByPolicy[action.policy] as never)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pb-2">
        <div>
          <div className="mb-1 font-medium text-xs">{t("proposedArgs")}</div>
          <JsonBlock value={action.args} />
        </div>
        <div>
          <div className="mb-1 font-medium text-xs">{t("currentState")}</div>
          {action.currentState ? (
            <JsonBlock value={action.currentState} />
          ) : (
            <p className="text-muted-foreground text-xs">
              {t("noCurrentState")}
            </p>
          )}
        </div>
        {action.resourcePath ? (
          <Link
            className="inline-flex items-center gap-1 text-primary text-xs underline"
            href={`/space/${workspaceId}${action.resourcePath}`}
          >
            <ExternalLinkIcon aria-hidden className="size-3" />
            {t("openResource")}
          </Link>
        ) : null}
      </CardContent>
      {pending ? (
        <CardFooter className="gap-2">
          <Button
            disabled={isDeciding}
            onClick={() => onConfirm(action.id)}
            size="sm"
            type="button"
          >
            {isDeciding ? (
              <Loader2Icon className="animate-spin" data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            {t("confirm")}
          </Button>
          <Button
            disabled={isDeciding}
            onClick={() => onReject(action.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            <XIcon data-icon="inline-start" />
            {t("reject")}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

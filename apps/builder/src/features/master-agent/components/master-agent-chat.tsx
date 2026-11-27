"use client"

import { Button } from "@inboxos.io/ui/components/ui/button"
import { Textarea } from "@inboxos.io/ui/components/ui/textarea"
import { cn } from "@inboxos.io/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2Icon, SendIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"
import { orpc } from "@/lib/orpc/query"
import { MasterAgentPendingActionCard } from "./master-agent-pending-action-card"

const POLL_INTERVAL_MS = 2000

/**
 * The Master Agent chat: describe the task, watch the turn run, then approve
 * the actions it proposed. Confirming is the ONLY way a gated action executes
 * — the agent itself never runs one.
 */
export function MasterAgentChat({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("masterAgent")
  const queryClient = useQueryClient()
  const [message, setMessage] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)

  const getSession = orpc.masterAgentAPIs.getMasterAgentSessionAPI
  const session = useQuery({
    ...getSession.queryOptions({
      input: { workspaceId, sessionId: sessionId ?? "" },
    }),
    enabled: sessionId !== null,
    // One turn is one queued job; poll until it finishes, then stop.
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? POLL_INTERVAL_MS : false,
  })

  const send = useMutation(
    orpc.masterAgentAPIs.sendMasterAgentMessageAPI.mutationOptions({
      onSuccess: (view) => {
        setSessionId(view.sessionId)
        setMessage("")
        queryClient.setQueryData(
          getSession.queryKey({
            input: { workspaceId, sessionId: view.sessionId },
          }),
          view,
        )
      },
      onError: () => toast.error(t("errors.sendFailed")),
    }),
  )

  const confirm = useMutation(
    orpc.masterAgentAPIs.confirmMasterAgentPendingActionAPI.mutationOptions({
      // The action's new status lives in the session read, not in the confirm
      // response, so the card switches only on the refreshed session.
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getSession.key() })
      },
      onError: () => toast.error(t("errors.confirmFailed")),
    }),
  )

  const reject = useMutation(
    orpc.masterAgentAPIs.rejectMasterAgentPendingActionAPI.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getSession.key() })
      },
      onError: () => toast.error(t("errors.rejectFailed")),
    }),
  )
  // The confirm executes the stored API call server-side; the session read
  // only reflects the settled row once it finishes, so the card disables
  // both buttons while either decision is in flight.
  const deciding = confirm.isPending || reject.isPending
  const working = send.isPending || session.data?.status === "pending"
  const messages = session.data?.messages ?? []
  const pendingActions = (session.data?.pendingActions ?? []).filter(
    (action) => action.status === "pending",
  )

  const submit = () => {
    const text = message.trim()
    if (!text || working) {
      return
    }
    send.mutate({
      workspaceId,
      message: text,
      sessionId: sessionId ?? undefined,
    })
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex min-h-64 flex-col gap-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : null}
        {messages.map((item) => (
          <div
            className={cn(
              "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
              item.role === "user"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start bg-muted",
            )}
            key={item.id}
          >
            {item.content ||
              (item.status === "pending" ? t("thinking") : t("emptyReply"))}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          disabled={working}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={t("placeholder")}
          rows={5}
          value={message}
        />
        <Button
          className="self-end"
          disabled={working || message.trim().length === 0}
          onClick={submit}
          type="button"
        >
          {working ? (
            <Loader2Icon className="animate-spin" data-icon="inline-start" />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          {t("send")}
        </Button>
      </div>

      {pendingActions.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium text-sm">{t("pendingActionsTitle")}</h2>
          {pendingActions.map((action) => (
            <MasterAgentPendingActionCard
              action={action}
              isDeciding={
                deciding &&
                (confirm.variables?.actionId === action.id ||
                  reject.variables?.actionId === action.id)
              }
              key={action.id}
              onConfirm={(actionId) =>
                confirm.mutate({ workspaceId, actionId })
              }
              onReject={(actionId) => reject.mutate({ workspaceId, actionId })}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

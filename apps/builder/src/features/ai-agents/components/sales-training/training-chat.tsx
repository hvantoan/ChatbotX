"use client"

import type { AIAgentSalesProfile } from "@chatbotx.io/database/partials"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@chatbotx.io/ui/components/ui/alert-dialog"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import { Textarea } from "@chatbotx.io/ui/components/ui/textarea"
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  Loader2Icon,
  MessageSquarePlusIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import { useIsLocked } from "@/features/templates/components/lock-context"
import { client } from "@/lib/orpc/orpc"
import { orpc } from "@/lib/orpc/query"
import { ProposalCard } from "./proposal-card"
import { type SalesProductOption, SalesProfileView } from "./sales-profile-view"
import { VersionHistory } from "./version-history"

export type TrainingChatProps = {
  workspaceId: string
  aiAgentId: string
}

export function TrainingChat({ workspaceId, aiAgentId }: TrainingChatProps) {
  const t = useTranslations("aiAgentSalesTraining")
  const queryClient = useQueryClient()
  const isLocked = useIsLocked(aiAgentId)

  const [instruction, setInstruction] = useState("")
  const [dismissedMessageIds, setDismissedMessageIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [draftOverride, setDraftOverride] =
    useState<AIAgentSalesProfile | null>(null)

  const profileQuery = useQuery(
    orpc.aiAgentsAPI.getSalesProfileAPI.queryOptions({
      input: { workspaceId, id: aiAgentId },
      enabled: Boolean(workspaceId && aiAgentId),
    }),
  )

  const productsQuery = useQuery(
    orpc.productsAPI.listProductsAuthorizedAPI.queryOptions({
      input: {
        workspaceId,
        status: "active",
        page: 1,
        perPage: 50,
      },
      enabled: Boolean(workspaceId),
    }),
  )

  const messagesQuery = useInfiniteQuery({
    queryKey: [
      ...orpc.aiAgentsAPI.listTrainingMessagesAPI.key(),
      workspaceId,
      aiAgentId,
    ],
    queryFn: async ({ pageParam }) =>
      await client.aiAgentsAPI.listTrainingMessagesAPI({
        workspaceId,
        id: aiAgentId,
        cursor: pageParam ?? undefined,
        limit: 30,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(workspaceId && aiAgentId),
  })

  const activeProducts: SalesProductOption[] = useMemo(
    () =>
      (productsQuery.data?.data ?? [])
        .filter((p) => p.status === "active")
        .map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          currency: p.currency,
        })),
    [productsQuery.data],
  )

  const productNameById = useMemo(
    () => new Map(activeProducts.map((p) => [p.id, p.name])),
    [activeProducts],
  )

  const proposeMutation = useMutation({
    mutationFn: async (text: string) =>
      await client.aiAgentsAPI.proposeSalesProfileAPI({
        workspaceId,
        id: aiAgentId,
        instruction: text,
      }),
    onSuccess: async () => {
      setInstruction("")
      await queryClient.invalidateQueries({
        queryKey: orpc.aiAgentsAPI.key(),
      })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("chat.proposeError"))
    },
  })

  const applyMutation = useMutation({
    mutationFn: async (params: {
      profile: AIAgentSalesProfile
      messageId?: string
      instructionText?: string
    }) =>
      await client.aiAgentsAPI.applySalesProfileAPI({
        workspaceId,
        id: aiAgentId,
        profile: params.profile,
        messageId: params.messageId,
        instruction: params.instructionText,
      }),
    onSuccess: async (res) => {
      // The applied profile is now the server state; a leftover edit draft
      // would keep rendering an older proposal and could overwrite this one.
      setDraftOverride(null)
      await queryClient.invalidateQueries({
        queryKey: orpc.aiAgentsAPI.key(),
      })
      toast.success(t("proposal.appliedSuccess", { version: res.version }))
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("proposal.applyError"))
    },
  })

  const clearMutation = useMutation({
    mutationFn: async () =>
      await client.aiAgentsAPI.clearTrainingMessagesAPI({
        workspaceId,
        id: aiAgentId,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.aiAgentsAPI.key(),
      })
      toast.success(t("chat.clearedSuccess"))
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("chat.clearError"))
    },
  })

  const chronologicalMessages = useMemo(() => {
    const all = messagesQuery.data?.pages.flatMap((page) => page.items) ?? []
    return [...all].reverse()
  }, [messagesQuery.data])

  const handleSend = () => {
    const trimmed = instruction.trim()
    if (!trimmed || proposeMutation.isPending || isLocked) {
      return
    }
    proposeMutation.mutate(trimmed)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Chat box & proposal history */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="font-semibold text-sm">{t("chat.title")}</h4>
            <p className="text-muted-foreground text-xs">
              {t("chat.description")}
            </p>
          </div>

          {chronologicalMessages.length > 0 ? (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    disabled={isLocked || clearMutation.isPending}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Trash2Icon aria-hidden className="size-3.5" />
                    {t("chat.clearButton")}
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("chat.clearConfirmTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("chat.clearConfirmDescription")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("proposal.cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => clearMutation.mutate()}>
                    {t("chat.clearButton")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>

        <div className="flex max-h-96 min-h-44 flex-col gap-3 overflow-y-auto rounded-md border border-border bg-muted/20 p-3">
          {messagesQuery.hasNextPage ? (
            <Button
              className="self-center"
              disabled={messagesQuery.isFetchingNextPage}
              onClick={() => messagesQuery.fetchNextPage()}
              size="sm"
              type="button"
              variant="ghost"
            >
              {messagesQuery.isFetchingNextPage ? (
                <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
              ) : null}
              {t("chat.loadOlder")}
            </Button>
          ) : null}

          {messagesQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <Loader2Icon
                aria-hidden
                className="size-5 animate-spin text-muted-foreground"
              />
            </div>
          ) : null}

          {!messagesQuery.isLoading && chronologicalMessages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center text-muted-foreground text-xs">
              <MessageSquarePlusIcon aria-hidden className="size-6" />
              <p>{t("chat.emptyHint")}</p>
            </div>
          ) : null}

          {!messagesQuery.isLoading && chronologicalMessages.length > 0
            ? chronologicalMessages.map((msg, index) => {
                const isAdmin = msg.role === "admin"
                const prevAdminInstruction =
                  !isAdmin &&
                  index > 0 &&
                  chronologicalMessages[index - 1]?.role === "admin"
                    ? chronologicalMessages[index - 1]?.content
                    : undefined
                const isDismissed = dismissedMessageIds.has(msg.id)

                return (
                  <div
                    className={`flex flex-col gap-2 ${
                      isAdmin ? "items-end" : "items-start"
                    }`}
                    key={msg.id}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                        isAdmin
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-background text-foreground"
                      }`}
                    >
                      {msg.content}
                    </div>

                    {!isAdmin && msg.proposal && !isDismissed ? (
                      <div className="w-full max-w-[92%]">
                        <ProposalCard
                          appliedVersion={msg.appliedVersion}
                          disabled={isLocked}
                          isApplying={applyMutation.isPending}
                          onApply={(proposedProfile) =>
                            applyMutation.mutate({
                              profile: proposedProfile,
                              messageId: msg.id,
                              instructionText: prevAdminInstruction,
                            })
                          }
                          onCancel={() =>
                            setDismissedMessageIds((prev) => {
                              const next = new Set(prev)
                              next.add(msg.id)
                              return next
                            })
                          }
                          onEdit={(proposedProfile) =>
                            setDraftOverride(proposedProfile)
                          }
                          productNameById={productNameById}
                          proposal={msg.proposal}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })
            : null}
        </div>

        <div className="flex items-end gap-2">
          <Textarea
            className="min-h-16 flex-1 text-xs"
            disabled={isLocked || proposeMutation.isPending}
            maxLength={4000}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={t("chat.inputPlaceholder")}
            value={instruction}
          />
          <Button
            disabled={
              isLocked || !instruction.trim() || proposeMutation.isPending
            }
            onClick={handleSend}
            type="button"
          >
            {proposeMutation.isPending ? (
              <Loader2Icon aria-hidden className="size-4 animate-spin" />
            ) : (
              <SendIcon aria-hidden className="size-4" />
            )}
            {t("chat.sendButton")}
          </Button>
        </div>
      </div>

      {/* Structured Sales Profile View & Manual Editor */}
      <SalesProfileView
        aiAgentId={aiAgentId}
        disabled={isLocked}
        draftOverride={draftOverride}
        onClearDraftOverride={() => setDraftOverride(null)}
        products={activeProducts}
        profile={profileQuery.data?.profile ?? null}
        version={profileQuery.data?.version ?? 0}
        workspaceId={workspaceId}
      />

      {/* Immutable Version History with Revert */}
      <VersionHistory
        aiAgentId={aiAgentId}
        currentVersion={profileQuery.data?.version ?? 0}
        disabled={isLocked}
        workspaceId={workspaceId}
      />
    </div>
  )
}

export default TrainingChat

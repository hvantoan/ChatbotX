"use client"

import { Badge } from "@chatbotx.io/ui/components/ui/badge"
import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { HistoryIcon, Loader2Icon, RotateCcwIcon } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { client } from "@/lib/orpc/orpc"
import { orpc } from "@/lib/orpc/query"

export type VersionHistoryProps = {
  workspaceId: string
  aiAgentId: string
  currentVersion: number
  disabled?: boolean
}

export function VersionHistory({
  workspaceId,
  aiAgentId,
  currentVersion,
  disabled = false,
}: VersionHistoryProps) {
  const t = useTranslations("aiAgentSalesTraining")
  const queryClient = useQueryClient()

  const versionsQuery = useInfiniteQuery({
    queryKey: [
      ...orpc.aiAgentsAPI.listSalesProfileVersionsAPI.key(),
      workspaceId,
      aiAgentId,
    ],
    queryFn: async ({ pageParam }) =>
      await client.aiAgentsAPI.listSalesProfileVersionsAPI({
        workspaceId,
        id: aiAgentId,
        cursor: pageParam ?? undefined,
        limit: 10,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(workspaceId && aiAgentId),
  })

  const revertMutation = useMutation({
    mutationFn: async (version: number) =>
      await client.aiAgentsAPI.revertSalesProfileAPI({
        workspaceId,
        id: aiAgentId,
        version,
      }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.aiAgentsAPI.key(),
      })
      toast.success(t("versions.revertedSuccess", { version: res.version }))
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : t("versions.revertError"),
      )
    },
  })

  const items = versionsQuery.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <HistoryIcon aria-hidden className="size-4 text-muted-foreground" />
        <h4 className="font-semibold text-sm">{t("versions.title")}</h4>
      </div>

      {versionsQuery.isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2Icon
            aria-hidden
            className="size-5 animate-spin text-muted-foreground"
          />
        </div>
      ) : null}

      {!versionsQuery.isLoading && items.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t("versions.empty")}</p>
      ) : null}

      {!versionsQuery.isLoading && items.length > 0 ? (
        <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {items.map((item) => {
            const isCurrent = item.version === currentVersion
            return (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5 text-xs"
                key={item.id}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">v{item.version}</span>
                    <Badge variant="outline">
                      {t(`versions.sources.${item.source}`)}
                    </Badge>
                    {isCurrent ? (
                      <Badge variant="secondary">{t("versions.active")}</Badge>
                    ) : null}
                  </div>
                  {item.instruction ? (
                    <p className="truncate text-muted-foreground">
                      {item.instruction}
                    </p>
                  ) : null}
                </div>

                {isCurrent ? null : (
                  <Button
                    disabled={disabled || revertMutation.isPending}
                    onClick={() => revertMutation.mutate(item.version)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RotateCcwIcon aria-hidden className="size-3.5" />
                    {t("versions.revert")}
                  </Button>
                )}
              </div>
            )
          })}

          {versionsQuery.hasNextPage ? (
            <Button
              disabled={versionsQuery.isFetchingNextPage}
              onClick={() => versionsQuery.fetchNextPage()}
              size="sm"
              type="button"
              variant="ghost"
            >
              {versionsQuery.isFetchingNextPage ? (
                <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
              ) : null}
              {t("versions.loadMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

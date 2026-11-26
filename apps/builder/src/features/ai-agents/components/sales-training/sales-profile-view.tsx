"use client"

import {
  type AIAgentSalesProfile,
  type AIAgentSalesTargetProduct,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@inboxos.io/database/partials"
import { Badge } from "@inboxos.io/ui/components/ui/badge"
import { Button } from "@inboxos.io/ui/components/ui/button"
import { Input } from "@inboxos.io/ui/components/ui/input"
import { Label } from "@inboxos.io/ui/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@inboxos.io/ui/components/ui/select"
import { Switch } from "@inboxos.io/ui/components/ui/switch"
import { Textarea } from "@inboxos.io/ui/components/ui/textarea"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2Icon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { client } from "@/lib/orpc/orpc"
import { orpc } from "@/lib/orpc/query"

export type SalesProductOption = {
  id: string
  name: string
  price: number
  currency: string
}

const DEFAULT_PROFILE: AIAgentSalesProfile = {
  enabled: false,
  tone: "",
  role: "",
  objective: "",
  targetProducts: [],
  forbiddenTopics: [],
  offTopicLimit: 3,
  handoverOnHumanRequest: true,
  handoffMessage: DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
  handoffTriggers: "",
}

export type SalesProfileViewProps = {
  workspaceId: string
  aiAgentId: string
  profile: AIAgentSalesProfile | null
  version: number
  products: SalesProductOption[]
  draftOverride?: AIAgentSalesProfile | null
  onClearDraftOverride?: () => void
  disabled?: boolean
}

type TargetProductRow = AIAgentSalesTargetProduct & {
  rowId: string
}

type SalesProfileFormState = Omit<AIAgentSalesProfile, "targetProducts"> & {
  targetProducts: TargetProductRow[]
}

let targetProductRowCounter = 0
function nextTargetProductRowId(): string {
  targetProductRowCounter += 1
  return `target-product-row-${targetProductRowCounter}`
}

function toFormState(source: AIAgentSalesProfile): SalesProfileFormState {
  return {
    ...source,
    targetProducts: source.targetProducts.map((tp) => ({
      ...tp,
      rowId: nextTargetProductRowId(),
    })),
  }
}

function formatProductLabel(product: SalesProductOption): string {
  return `${product.name} (${product.price.toLocaleString()} ${product.currency})`
}

export function SalesProfileView({
  workspaceId,
  aiAgentId,
  profile,
  version,
  products,
  draftOverride,
  onClearDraftOverride,
  disabled = false,
}: SalesProfileViewProps) {
  const t = useTranslations("aiAgentSalesTraining")
  const queryClient = useQueryClient()

  const [formState, setFormState] = useState<SalesProfileFormState>(() =>
    toFormState(draftOverride ?? profile ?? DEFAULT_PROFILE),
  )
  const [forbiddenInput, setForbiddenInput] = useState("")

  useEffect(() => {
    const next = draftOverride ?? profile ?? DEFAULT_PROFILE
    setFormState(toFormState(next))
    setForbiddenInput(next.forbiddenTopics.join(", "))
  }, [profile, draftOverride])

  const updateMutation = useMutation({
    mutationFn: async (nextProfile: AIAgentSalesProfile) =>
      await client.aiAgentsAPI.updateSalesProfileAPI({
        workspaceId,
        id: aiAgentId,
        profile: nextProfile,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.aiAgentsAPI.key(),
      })
      onClearDraftOverride?.()
      toast.success(t("profile.savedSuccess"))
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("profile.saveError"))
    },
  })

  const handleSave = () => {
    const parsedForbidden = forbiddenInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20)

    updateMutation.mutate({
      ...formState,
      targetProducts: formState.targetProducts.map(
        ({ rowId: _rowId, ...rest }) => rest,
      ),
      forbiddenTopics: parsedForbidden,
    })
  }

  const usedProductIds = new Set(
    formState.targetProducts.map((tp) => tp.productId),
  )
  const hasUnusedProduct = products.some((p) => !usedProductIds.has(p.id))
  const productSelectItems = products.map((product) => ({
    value: product.id,
    label: formatProductLabel(product),
  }))

  const handleAddTargetProduct = () => {
    if (formState.targetProducts.length >= 10) {
      return
    }
    const available = products.find((p) => !usedProductIds.has(p.id))
    if (!available) {
      return
    }
    const nextPriority = Math.min(10, formState.targetProducts.length + 1)
    setFormState((prev) => ({
      ...prev,
      targetProducts: [
        ...prev.targetProducts,
        {
          rowId: nextTargetProductRowId(),
          productId: available.id,
          priority: nextPriority,
          pitchNote: "",
        },
      ],
    }))
  }

  const handleRemoveTargetProduct = (index: number) => {
    setFormState((prev) => ({
      ...prev,
      targetProducts: prev.targetProducts.filter((_, idx) => idx !== index),
    }))
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-sm">{t("profile.title")}</h4>
          <Badge variant="outline">
            {version > 0
              ? t("profile.versionBadge", { version })
              : t("profile.unconfiguredBadge")}
          </Badge>
          {draftOverride ? (
            <Badge variant="secondary">
              {t("profile.editingProposalBadge")}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs" htmlFor="sales-profile-enabled-switch">
            {t("fields.enabled")}
          </Label>
          <Switch
            checked={formState.enabled}
            disabled={disabled || updateMutation.isPending}
            id="sales-profile-enabled-switch"
            onCheckedChange={(checked) =>
              setFormState((prev) => ({ ...prev, enabled: checked }))
            }
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t("fields.role")}</Label>
          <Input
            disabled={disabled}
            maxLength={500}
            onChange={(e) =>
              setFormState((prev) => ({ ...prev, role: e.target.value }))
            }
            placeholder={t("profile.rolePlaceholder")}
            value={formState.role}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t("fields.tone")}</Label>
          <Input
            disabled={disabled}
            maxLength={1000}
            onChange={(e) =>
              setFormState((prev) => ({ ...prev, tone: e.target.value }))
            }
            placeholder={t("profile.tonePlaceholder")}
            value={formState.tone}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">{t("fields.objective")}</Label>
        <Textarea
          className="min-h-16"
          disabled={disabled}
          maxLength={1000}
          onChange={(e) =>
            setFormState((prev) => ({ ...prev, objective: e.target.value }))
          }
          placeholder={t("profile.objectivePlaceholder")}
          value={formState.objective}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t("fields.targetProducts")}</Label>
          <Button
            disabled={
              disabled ||
              formState.targetProducts.length >= 10 ||
              !hasUnusedProduct
            }
            onClick={handleAddTargetProduct}
            size="sm"
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden className="size-3.5" />
            {t("profile.addProduct")}
          </Button>
        </div>

        {formState.targetProducts.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("profile.noTargetProducts")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {formState.targetProducts.map((item, idx) => (
              <div
                className="grid gap-2 rounded-md border border-border p-2.5 sm:grid-cols-12"
                key={item.rowId}
              >
                <div className="sm:col-span-5">
                  <Select
                    disabled={disabled}
                    items={productSelectItems}
                    onValueChange={(val) => {
                      if (!val || typeof val !== "string") {
                        return
                      }
                      setFormState((prev) => ({
                        ...prev,
                        targetProducts: prev.targetProducts.map((tp, i) =>
                          i === idx ? { ...tp, productId: val } : tp,
                        ),
                      }))
                    }}
                    value={item.productId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("profile.selectProduct")} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem
                          disabled={
                            usedProductIds.has(product.id) &&
                            product.id !== item.productId
                          }
                          key={product.id}
                          value={product.id}
                        >
                          {formatProductLabel(product)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-2">
                  <Input
                    aria-label={t("profile.priorityLabel")}
                    disabled={disabled}
                    max={10}
                    min={1}
                    onChange={(e) => {
                      const val = Number.parseInt(e.target.value, 10)
                      if (Number.isNaN(val)) {
                        return
                      }
                      setFormState((prev) => ({
                        ...prev,
                        targetProducts: prev.targetProducts.map((tp, i) =>
                          i === idx
                            ? {
                                ...tp,
                                priority: Math.min(10, Math.max(1, val)),
                              }
                            : tp,
                        ),
                      }))
                    }}
                    type="number"
                    value={item.priority}
                  />
                </div>

                <div className="sm:col-span-4">
                  <Input
                    disabled={disabled}
                    maxLength={500}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        targetProducts: prev.targetProducts.map((tp, i) =>
                          i === idx ? { ...tp, pitchNote: e.target.value } : tp,
                        ),
                      }))
                    }
                    placeholder={t("profile.pitchNotePlaceholder")}
                    value={item.pitchNote ?? ""}
                  />
                </div>

                <div className="flex items-center justify-end sm:col-span-1">
                  <Button
                    aria-label={t("profile.removeProduct")}
                    disabled={disabled}
                    onClick={() => handleRemoveTargetProduct(idx)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2Icon aria-hidden className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t("fields.forbiddenTopics")}</Label>
          <Input
            disabled={disabled}
            onChange={(e) => setForbiddenInput(e.target.value)}
            placeholder={t("profile.forbiddenTopicsPlaceholder")}
            value={forbiddenInput}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t("fields.offTopicLimit")}</Label>
          <Input
            disabled={disabled}
            max={10}
            min={1}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value, 10)
              if (Number.isNaN(val)) {
                return
              }
              setFormState((prev) => ({
                ...prev,
                offTopicLimit: Math.min(10, Math.max(1, val)),
              }))
            }}
            type="number"
            value={formState.offTopicLimit}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t("fields.handoffMessage")}</Label>
          <Input
            disabled={disabled}
            maxLength={500}
            onChange={(e) =>
              setFormState((prev) => ({
                ...prev,
                handoffMessage: e.target.value,
              }))
            }
            placeholder={t("profile.handoffMessagePlaceholder")}
            value={formState.handoffMessage}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t("fields.handoffTriggers")}</Label>
          <Input
            disabled={disabled}
            maxLength={1000}
            onChange={(e) =>
              setFormState((prev) => ({
                ...prev,
                handoffTriggers: e.target.value,
              }))
            }
            placeholder={t("profile.handoffTriggersPlaceholder")}
            value={formState.handoffTriggers}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <Switch
            checked={formState.handoverOnHumanRequest}
            disabled={disabled}
            id="sales-profile-handover-switch"
            onCheckedChange={(checked) =>
              setFormState((prev) => ({
                ...prev,
                handoverOnHumanRequest: checked,
              }))
            }
          />
          <Label className="text-xs" htmlFor="sales-profile-handover-switch">
            {t("fields.handoverOnHumanRequest")}
          </Label>
        </div>

        <div className="flex items-center gap-2">
          {draftOverride && onClearDraftOverride ? (
            <Button
              disabled={disabled || updateMutation.isPending}
              onClick={onClearDraftOverride}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("proposal.cancel")}
            </Button>
          ) : null}
          <Button
            disabled={disabled || updateMutation.isPending}
            onClick={handleSave}
            size="sm"
            type="button"
          >
            {updateMutation.isPending ? (
              <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <SaveIcon aria-hidden className="size-3.5" />
            )}
            {t("profile.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

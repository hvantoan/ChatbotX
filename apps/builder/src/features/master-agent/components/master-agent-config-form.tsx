"use client"

import { aiChatProviders, openaiCompatiblePresetConfigs } from "@inboxos.io/ai"
import type { AIAgentProviderModels } from "@inboxos.io/database/partials"
import { Button } from "@inboxos.io/ui/components/ui/button"
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
import { Loader2Icon } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"
import { getAiProviderLabelKey } from "@/features/ai-agents/lib/ai-provider-label"
import { getOpenaiCompatibleIntegrationLabel } from "@/features/ai-agents/openai-compatible-models"
import type { IntegrationOpenaiCompatibleResource } from "@/features/integration-openai-compatible/schema/resource"
import { orpc } from "@/lib/orpc/query"
import {
  buildEditableMasterAgentModels,
  collectSelectedMasterAgentModels,
  masterAgentModelKey,
} from "../lib/model-selection"

export type MasterAgentConfigFormData = {
  configured: boolean
  enabled: boolean
  autoApproveDiff: boolean
  prompt: string | null
  models: unknown[]
}

type ProviderModelEntry = Extract<
  AIAgentProviderModels[number],
  { provider: string }
>

type EditableModelEntry = AIAgentProviderModels[number]

/**
 * The workspace's Master Agent settings: enablement, approval mode, extra
 * instructions, and the provider models it answers with. Saving upserts the
 * single config row; there is no per-model temperature here — the agent runs
 * with the provider defaults.
 */
export function MasterAgentConfigForm({
  workspaceId,
  initialConfig,
  openaiCompatibleIntegrations,
}: {
  workspaceId: string
  initialConfig: MasterAgentConfigFormData
  openaiCompatibleIntegrations: IntegrationOpenaiCompatibleResource[]
}) {
  const t = useTranslations("masterAgent")
  const tFields = useTranslations()
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(initialConfig.enabled)
  const [autoApproveDiff, setAutoApproveDiff] = useState(
    initialConfig.autoApproveDiff,
  )
  const [prompt, setPrompt] = useState(initialConfig.prompt ?? "")
  const [models, setModels] = useState<AIAgentProviderModels>(() => {
    const editable = buildEditableMasterAgentModels({
      storedModels: initialConfig.models,
      integrations: openaiCompatibleIntegrations,
      selectAllWhenEmpty: !initialConfig.configured,
    })
    return editable.rows
  })
  const [selectedModelKeys, setSelectedModelKeys] = useState<
    ReadonlySet<string>
  >(
    () =>
      new Set(
        buildEditableMasterAgentModels({
          storedModels: initialConfig.models,
          integrations: openaiCompatibleIntegrations,
          selectAllWhenEmpty: !initialConfig.configured,
        }).selectedKeys,
      ),
  )

  const getConfig = orpc.masterAgentAPIs.getMasterAgentConfigAPI
  const save = useMutation(
    orpc.masterAgentAPIs.updateMasterAgentConfigAPI.mutationOptions({
      onSuccess: async (view) => {
        setEnabled(view.enabled)
        setAutoApproveDiff(view.autoApproveDiff)
        setPrompt(view.prompt ?? "")
        await queryClient.invalidateQueries({ queryKey: getConfig.key() })
        toast.success(t("config.save"))
      },
      onError: () => toast.error(t("errors.saveConfigFailed")),
    }),
  )

  const updateModel = (index: number, model: string) => {
    setModels(
      (current) =>
        current.map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, model } : entry,
        ) as AIAgentProviderModels,
    )
  }

  const toggleModel = (key: string, selected: boolean) => {
    setSelectedModelKeys((current) => {
      const next = new Set(current)
      if (selected) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return next
    })
  }

  const submit = () => {
    save.mutate({
      workspaceId,
      enabled,
      autoApproveDiff,
      prompt: prompt.trim() ? prompt.trim() : null,
      models: collectSelectedMasterAgentModels(models, selectedModelKeys),
    })
  }

  const renderModelPicker = (
    entry: EditableModelEntry,
    index: number,
    label: string,
    options: Array<{ label: string; value: string }>,
  ) => {
    const key = masterAgentModelKey(entry)
    const selected = selectedModelKeys.has(key)
    const hasCurrentOption = options.some(
      (option) => option.value === entry.model,
    )
    return (
      <div className="flex items-center justify-between gap-4" key={key}>
        <Label className="min-w-0 flex-1">{label}</Label>
        <div className="flex items-center gap-2">
          <Switch
            aria-label={t("config.includeModel", { provider: label })}
            checked={selected}
            onCheckedChange={(checked) => toggleModel(key, checked)}
          />
          <Select
            disabled={!selected}
            onValueChange={(value) => updateModel(index, value as string)}
            value={entry.model}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
              {hasCurrentOption ? null : (
                <SelectItem value={entry.model}>{entry.model}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {initialConfig.configured ? null : (
        <p className="text-muted-foreground text-sm">
          {t("config.notConfigured")}
        </p>
      )}

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="master-agent-enabled">{t("config.enabled")}</Label>
        <Switch
          checked={enabled}
          id="master-agent-enabled"
          onCheckedChange={setEnabled}
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="master-agent-auto-approve">
            {t("config.autoApproveDiff")}
          </Label>
          <Switch
            checked={autoApproveDiff}
            id="master-agent-auto-approve"
            onCheckedChange={setAutoApproveDiff}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {t("config.autoApproveDiffHint")}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="master-agent-prompt">{t("config.prompt")}</Label>
        <Textarea
          id="master-agent-prompt"
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          value={prompt}
        />
        <p className="text-muted-foreground text-xs">
          {t("config.promptHint")}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="font-medium text-sm">{t("config.models")}</div>
        {models.map((entry, index) => {
          if ("kind" in entry) {
            const integration = openaiCompatibleIntegrations.find(
              (item) => item.id === entry.integrationId,
            )
            const presetConfig = integration
              ? openaiCompatiblePresetConfigs[
                  integration.preset as keyof typeof openaiCompatiblePresetConfigs
                ]
              : undefined
            const label = integration
              ? getOpenaiCompatibleIntegrationLabel(integration)
              : entry.integrationId
            return renderModelPicker(
              entry,
              index,
              label,
              presetConfig?.modelOptions ?? [],
            )
          }

          const providerEntry = entry as ProviderModelEntry
          const provider = aiChatProviders.find(
            (item) => item.provider === providerEntry.provider,
          )
          if (!provider) {
            return null
          }
          return renderModelPicker(
            providerEntry,
            index,
            tFields(getAiProviderLabelKey(provider.provider) as never),
            provider.modelOptions,
          )
        })}
      </div>

      <Button
        className="self-end"
        disabled={save.isPending}
        onClick={submit}
        type="button"
      >
        {save.isPending ? (
          <Loader2Icon className="animate-spin" data-icon="inline-start" />
        ) : null}
        {t("config.save")}
      </Button>
    </div>
  )
}

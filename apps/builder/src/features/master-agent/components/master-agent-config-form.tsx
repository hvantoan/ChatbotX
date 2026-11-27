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
import {
  buildOpenaiCompatibleAgentModels,
  getOpenaiCompatibleIntegrationLabel,
} from "@/features/ai-agents/openai-compatible-models"
import type { IntegrationOpenaiCompatibleResource } from "@/features/integration-openai-compatible/schema/resource"
import { orpc } from "@/lib/orpc/query"

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

/**
 * The provider rows of a stored/normalized models list keyed for editing:
 * one row per known chat provider plus one per connected openai-compatible
 * integration, each carrying its chosen model. Mirrors what the AI agent
 * dialog does for `agent.models` so both surfaces edit the same shape.
 */
const buildEditableModels = (
  storedModels: unknown[],
  integrations: IntegrationOpenaiCompatibleResource[],
): AIAgentProviderModels => {
  const stored = storedModels as AIAgentProviderModels
  const normalizedProviders = aiChatProviders.map((provider) => ({
    provider: provider.provider,
    model:
      stored.find(
        (model) => "provider" in model && model.provider === provider.provider,
      )?.model ?? provider.defaultModel,
  }))
  return [
    ...normalizedProviders,
    ...buildOpenaiCompatibleAgentModels({
      integrations,
      storedModels: stored,
    }),
  ] as AIAgentProviderModels
}

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
  const [models, setModels] = useState<AIAgentProviderModels>(() =>
    buildEditableModels(initialConfig.models, openaiCompatibleIntegrations),
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

  const submit = () => {
    save.mutate({
      workspaceId,
      enabled,
      autoApproveDiff,
      prompt: prompt.trim() ? prompt.trim() : null,
      models,
    })
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
            return (
              <div
                className="flex items-center justify-between gap-4"
                key={`${entry.kind}-${entry.integrationId}`}
              >
                <Label className="min-w-0 flex-1">{label}</Label>
                <Select
                  onValueChange={(value) => updateModel(index, value as string)}
                  value={entry.model}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(presetConfig?.modelOptions ?? []).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                    {presetConfig?.modelOptions.some(
                      (option) => option.value === entry.model,
                    ) ? null : (
                      <SelectItem value={entry.model}>{entry.model}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )
          }

          const providerEntry = entry as ProviderModelEntry
          const provider = aiChatProviders.find(
            (item) => item.provider === providerEntry.provider,
          )
          if (!provider) {
            return null
          }
          return (
            <div
              className="flex items-center justify-between gap-4"
              key={providerEntry.provider}
            >
              <Label className="min-w-0 flex-1">
                {tFields(getAiProviderLabelKey(provider.provider) as never)}
              </Label>
              <Select
                onValueChange={(value) => updateModel(index, value as string)}
                value={providerEntry.model}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {provider.modelOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

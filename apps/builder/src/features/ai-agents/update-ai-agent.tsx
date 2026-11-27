"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { aiChatProviders, openaiCompatiblePresetConfigs } from "@inboxos.io/ai"
import {
  type AIAgentProviderModels,
  aiAgentActionRulesSchema,
  aiMessageRoles,
} from "@inboxos.io/database/partials"
import type { AIAgentModel } from "@inboxos.io/database/types"
import { InputField } from "@inboxos.io/ui/components/form/input-field"
import { SelectField } from "@inboxos.io/ui/components/form/select-field"
import { SliderField } from "@inboxos.io/ui/components/form/slider-field"
import { SwitchField } from "@inboxos.io/ui/components/form/switch-field"
import { Button } from "@inboxos.io/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@inboxos.io/ui/components/ui/dialog"
import { Form } from "@inboxos.io/ui/components/ui/form"
import { Label } from "@inboxos.io/ui/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@inboxos.io/ui/components/ui/popover"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@inboxos.io/ui/components/ui/tabs"
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks"
import {
  Loader2Icon,
  PlusIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { useEffect, useMemo } from "react"
import { useFieldArray } from "react-hook-form"
import { toast } from "sonner"
import { PlainTextEditorField } from "@/components/tiptap/plain-text-editor-field"
import { updateAIAgentAction } from "@/features/ai-agents/actions/update.action"
import { getAiProviderLabelKey } from "@/features/ai-agents/lib/ai-provider-label"
import {
  type UpdateAIAgentRequest,
  updateAIAgentRequest,
} from "@/features/ai-agents/schema/action"
import { AIToolMultiSelect } from "@/features/ai-tools/components/ai-tool-multi-select"
import type { IntegrationOpenaiCompatibleResource } from "@/features/integration-openai-compatible/schema/resource"
import {
  AIActionsField,
  type AIAgentActionOptions,
  normalizeAIAgentActionRulesForForm,
} from "./components/ai-actions-field"
import { WebSearchAuthorizedDomainsField } from "./components/web-search-authorized-domains-field"
import {
  buildOpenaiCompatibleAgentModels,
  getOpenaiCompatibleIntegrationLabel,
  shouldUseCustomOpenaiCompatibleModelInput,
} from "./openai-compatible-models"

const TrainingChat = dynamic(
  () => import("./components/sales-training/training-chat"),
  {
    ssr: false,
  },
)

export function UpdateAIAgentDialog({
  workspaceId,
  agent,
  openaiCompatibleIntegrations,
  actionOptions,
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (val: boolean) => void
  workspaceId: string
  agent: AIAgentModel | null
  openaiCompatibleIntegrations: IntegrationOpenaiCompatibleResource[]
  actionOptions: AIAgentActionOptions
  onSuccess?: () => void
}) {
  const t = useTranslations()

  const {
    form,
    handleSubmitWithAction,
    form: { setValue, control },
  } = useHookFormAction(
    updateAIAgentAction.bind(null, workspaceId, agent?.id ?? ""),
    zodResolver(updateAIAgentRequest),
    {
      actionProps: {
        onSuccess: () => {
          toast.success(
            t("messages.updatedSuccess", {
              feature: t("fields.aiAgent.label"),
            }),
          )

          onOpenChange(false)
          onSuccess?.()
        },
        onError: ({ error }) => {
          if (error.serverError) {
            toast.error(error.serverError)
          }
        },
      },
      formProps: {
        mode: "onChange",
      },
      errorMapProps: {},
    },
  )

  const {
    fields: messageFields,
    append: appendMessage,
    remove: removeMessage,
  } = useFieldArray({
    control,
    name: "messages",
  })
  const { fields: modelFields } = useFieldArray({
    control,
    name: "models",
  })

  const messageRoleOptions = useMemo(
    () => [
      { label: "User", value: aiMessageRoles.enum.user },
      { label: "Assistant", value: aiMessageRoles.enum.assistant },
    ],
    [],
  )

  const addOptions = () => {
    const lastRole: string =
      messageFields.at(-1)?.role || aiMessageRoles.enum.assistant
    appendMessage({
      role:
        lastRole === aiMessageRoles.enum.user
          ? aiMessageRoles.enum.assistant
          : aiMessageRoles.enum.user,
      content: "",
    })
  }

  useEffect(() => {
    if (agent) {
      // Normalize stored models to the full ordered provider list so agents
      // created before a provider existed still render every selector with a
      // sensible default (missing providers fall back to their default model).
      const storedModels = (agent.models ?? []) as AIAgentProviderModels
      const normalizedModels = aiChatProviders.map((provider) => ({
        provider: provider.provider,
        model:
          storedModels.find(
            (m) => "provider" in m && m.provider === provider.provider,
          )?.model ?? provider.defaultModel,
      }))
      const openaiCompatibleModels = buildOpenaiCompatibleAgentModels({
        integrations: openaiCompatibleIntegrations,
        storedModels,
      })

      setValue("name", agent.name)
      setValue("prompt", agent.prompt ?? "")
      setValue("models", [
        ...normalizedModels,
        ...openaiCompatibleModels,
      ] as UpdateAIAgentRequest["models"])
      setValue("temperature", agent.temperature)
      setValue("maxOutputTokens", agent.maxOutputTokens)
      setValue("messages", agent.messages as UpdateAIAgentRequest["messages"])
      setValue("tools", agent.tools)
      setValue("isRichResponse", agent.isRichResponse)
      setValue(
        "webSearchAuthorizedDomains",
        agent.webSearchAuthorizedDomains.map((domain) => ({ value: domain })),
      )
      setValue("actionPrompt", agent.actionPrompt ?? "")
      setValue(
        "actionRules",
        normalizeAIAgentActionRulesForForm(
          aiAgentActionRulesSchema.catch([]).parse(agent.actionRules),
        ),
      )
    }
  }, [agent, openaiCompatibleIntegrations, setValue])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pe-12 sm:px-6 sm:pe-14">
          <DialogTitle>
            {t("messages.editFeature", { feature: t("fields.aiAgent.label") })}
          </DialogTitle>
          <DialogDescription />
        </DialogHeader>

        <Tabs className="min-h-0 flex-1 gap-0" defaultValue="general">
          <div className="shrink-0 border-b px-4 sm:px-6">
            <TabsList className="rounded-none border-0 bg-transparent p-0 shadow-none">
              <TabsTrigger className="py-3" value="general">
                {t("aiAgentSalesTraining.tabs.general")}
              </TabsTrigger>
              <TabsTrigger className="py-3" value="training">
                {t("aiAgentSalesTraining.tabs.training")}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent className="flex min-h-0 flex-col" value="general">
            <Form {...form}>
              <form
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={handleSubmitWithAction}
              >
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                  <div className="space-y-6">
                    <InputField
                      label={t("fields.name.label")}
                      name="name"
                      required
                    />

                    <div>
                      <div className="flex items-center gap-4">
                        <div className="min-w-0 flex-1 font-medium text-sm">
                          {t("fields.instructions.label")}
                        </div>
                        <Popover>
                          <PopoverTrigger
                            render={
                              <Button
                                aria-label={t("actions.moreSettings")}
                                className="shrink-0"
                                size="icon"
                                type="button"
                                variant="ghost"
                              >
                                <SlidersHorizontalIcon
                                  aria-hidden
                                  className="size-4"
                                />
                              </Button>
                            }
                          />
                          <PopoverContent
                            align="start"
                            className="flex w-[340px] flex-col gap-6 overflow-y-auto overscroll-contain p-4"
                            side="right"
                            style={{
                              maxHeight:
                                "min(calc(var(--available-height) - 1rem), calc(100dvh - 2rem))",
                            }}
                          >
                            {modelFields.map((field, index) => {
                              if ("kind" in field) {
                                const integration =
                                  openaiCompatibleIntegrations.find(
                                    (item) => item.id === field.integrationId,
                                  )
                                const presetConfig = integration
                                  ? openaiCompatiblePresetConfigs[
                                      integration.preset as keyof typeof openaiCompatiblePresetConfigs
                                    ]
                                  : undefined
                                const providerLabel = integration
                                  ? getOpenaiCompatibleIntegrationLabel(
                                      integration,
                                    )
                                  : t("openaiCompatible.provider")
                                const label = `${providerLabel} ${t("fields.model.label")}`
                                if (
                                  shouldUseCustomOpenaiCompatibleModelInput(
                                    presetConfig,
                                  )
                                ) {
                                  return (
                                    <InputField
                                      key={field.id}
                                      label={label}
                                      name={`models.${index}.model`}
                                      required
                                    />
                                  )
                                }
                                return (
                                  <SelectField
                                    key={field.id}
                                    label={label}
                                    name={`models.${index}.model`}
                                    options={presetConfig?.modelOptions ?? []}
                                    required
                                  />
                                )
                              }

                              const provider = aiChatProviders.find(
                                (item) => item.provider === field.provider,
                              )
                              if (!provider) {
                                return null
                              }
                              return (
                                <SelectField
                                  key={field.id}
                                  label={`${t(getAiProviderLabelKey(provider.provider))} ${t("fields.model.label")}`}
                                  name={`models.${index}.model`}
                                  options={provider.modelOptions}
                                  required
                                />
                              )
                            })}

                            <SliderField
                              label={t("fields.temperature.label")}
                              max={2}
                              min={0}
                              name="temperature"
                              step={0.1}
                            />

                            <SliderField
                              label={t("fields.maxOutputTokens.label")}
                              max={32_768}
                              min={1}
                              name="maxOutputTokens"
                              step={1}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      <PlainTextEditorField
                        editorClassName="min-h-40 font-mono"
                        includeBotFieldVariables
                        name="prompt"
                        plainText
                      />
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="font-medium text-sm">
                        {t("fields.messages.label")}
                      </div>

                      {messageFields.map((item, index) => (
                        <div
                          className="relative rounded-md border border-input"
                          key={item.id}
                        >
                          <div className="absolute start-3 top-3">
                            <SelectField
                              name={`messages.${index}.role`}
                              options={messageRoleOptions}
                            />
                          </div>
                          <div className="ps-3 pe-12 pt-14 pb-3">
                            {/* No bot-field variables here: the runner interpolates
                            only `prompt` — configured messages reach the model
                            verbatim, so a token would never resolve. */}
                            <PlainTextEditorField
                              editorClassName="min-h-24 font-mono"
                              name={`messages.${index}.content`}
                              plainText
                            />
                          </div>
                          <Button
                            aria-label={t("actions.delete")}
                            className="absolute end-1 top-1"
                            onClick={() => removeMessage(index)}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <XIcon aria-hidden size={20} />
                          </Button>
                        </div>
                      ))}

                      <Button
                        className="w-28"
                        onClick={addOptions}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <PlusIcon aria-hidden />
                        {t("actions.addMore")}
                      </Button>
                    </div>

                    <AIToolMultiSelect name="tools" />
                    <WebSearchAuthorizedDomainsField />
                    <AIActionsField options={actionOptions} />
                    <div>
                      <div className="flex items-center gap-3">
                        <Label>{t("fields.isRichResponse.label")}</Label>
                        <SwitchField
                          formItemClassName="w-auto"
                          name="isRichResponse"
                        />
                      </div>
                      <p className="wrap-break-words mt-1.5 text-muted-foreground text-sm">
                        {t("fields.isRichResponse.description")}
                      </p>
                    </div>
                  </div>
                </div>

                <DialogFooter className="mx-0 mb-0 shrink-0 justify-end gap-2 px-4 py-4 sm:gap-2 sm:px-6">
                  <Button
                    onClick={() => onOpenChange(false)}
                    type="button"
                    variant="ghost"
                  >
                    {t("actions.cancel")}
                  </Button>
                  <Button
                    disabled={
                      (!form.formState.isValid &&
                        (form.formState.isDirty ||
                          form.formState.isSubmitted)) ||
                      form.formState.isSubmitting
                    }
                    type="submit"
                  >
                    {form.formState.isSubmitting && (
                      <Loader2Icon aria-hidden className="animate-spin" />
                    )}
                    {t("actions.confirm")}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </TabsContent>

          <TabsContent
            className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6"
            value="training"
          >
            {agent ? (
              <TrainingChat aiAgentId={agent.id} workspaceId={workspaceId} />
            ) : null}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

import { aiChatProviders } from "@inboxos.io/ai"
import type { AIAgentProviderModels } from "@inboxos.io/database/partials"
import { buildOpenaiCompatibleAgentModels } from "@/features/ai-agents/openai-compatible-models"
import type { IntegrationOpenaiCompatibleResource } from "@/features/integration-openai-compatible/schema/resource"

type EditableModelEntry = AIAgentProviderModels[number]

export type EditableMasterAgentModels = {
  /** Rows shown in the form: stored selections first, in their stored fallback order, then unused available choices. */
  rows: AIAgentProviderModels
  /** Keys of rows included in the fallback array. */
  selectedKeys: string[]
}

export const masterAgentModelKey = (entry: EditableModelEntry): string =>
  "kind" in entry
    ? `openaiCompatible:${entry.integrationId}`
    : `provider:${entry.provider}`

const availableModelChoices = (
  integrations: IntegrationOpenaiCompatibleResource[],
  storedModels: AIAgentProviderModels,
): AIAgentProviderModels =>
  [
    ...aiChatProviders.map((provider) => ({
      provider: provider.provider,
      model: provider.defaultModel,
    })),
    ...buildOpenaiCompatibleAgentModels({
      integrations,
      storedModels,
    }),
  ] as AIAgentProviderModels

/**
 * Separates available model choices from the selected fallback array. Rows
 * that were already stored keep their exact membership and relative order;
 * choices the workspace has never selected are appended only as available
 * rows. This is what stops a prompt-only save from silently prepending every
 * provider to an API-configured one-model fallback list.
 */
export const buildEditableMasterAgentModels = ({
  storedModels,
  integrations,
  selectAllWhenEmpty = false,
}: {
  storedModels: unknown[]
  integrations: IntegrationOpenaiCompatibleResource[]
  selectAllWhenEmpty?: boolean
}): EditableMasterAgentModels => {
  const stored = storedModels as AIAgentProviderModels
  const available = availableModelChoices(integrations, stored)
  const availableByKey = new Map(
    available.map((entry) => [masterAgentModelKey(entry), entry]),
  )

  const selectedRows: AIAgentProviderModels = []
  const selectedKeys = new Set<string>()
  for (const storedEntry of stored) {
    const key = masterAgentModelKey(storedEntry)
    const availableEntry = availableByKey.get(key)
    if (!availableEntry || selectedKeys.has(key)) {
      continue
    }
    selectedRows.push({
      ...availableEntry,
      model: storedEntry.model,
    } as EditableModelEntry)
    selectedKeys.add(key)
  }

  const unselectedRows = available.filter(
    (entry) => !selectedKeys.has(masterAgentModelKey(entry)),
  )
  const rows = [...selectedRows, ...unselectedRows] as AIAgentProviderModels

  return {
    rows,
    selectedKeys: selectAllWhenEmpty
      ? rows.map(masterAgentModelKey)
      : [...selectedKeys],
  }
}

export const collectSelectedMasterAgentModels = (
  rows: AIAgentProviderModels,
  selectedKeys: ReadonlySet<string>,
): AIAgentProviderModels =>
  rows.filter((entry) => selectedKeys.has(masterAgentModelKey(entry)))

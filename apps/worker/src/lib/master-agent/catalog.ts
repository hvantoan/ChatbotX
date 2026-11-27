import {
  apiBaseUrlFromBuilderUrl,
  createSpecLoader,
  type DynamicTool,
} from "@inboxos.io/openapi-catalog"
import { env } from "../../env"
import { logger } from "../logger"

const SPEC_TTL_MS = 30_000

/**
 * The worker process's one spec loader. `masterAgent.*` operations are
 * excluded: the agent driving the catalog must never call back into the chat
 * that spawned it — a `masterAgent.sendMessage` call from inside a turn would
 * queue a turn that queues a turn.
 */
const specLoader = createSpecLoader({
  apiUrl: apiBaseUrlFromBuilderUrl(env.NEXT_PUBLIC_BUILDER_URL),
  ttlMs: SPEC_TTL_MS,
  httpTimeoutMs: 15_000,
  excludeOperationIdPrefixes: ["masterAgent."],
  log: (message) => {
    logger.warn({}, `[master-agent] catalog: ${message}`)
  },
})

export const loadMasterAgentCatalog = async (): Promise<DynamicTool[]> =>
  await specLoader.refreshIfStale()

export const findCatalogToolByName = (name: string): DynamicTool | undefined =>
  specLoader.getToolByName(name)

export const getMasterAgentCatalogTools = (): DynamicTool[] =>
  specLoader.getTools()

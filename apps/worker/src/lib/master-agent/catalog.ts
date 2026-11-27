import {
  apiBaseUrlFromBuilderUrl,
  createSpecLoader,
  type DynamicTool,
} from "@inboxos.io/openapi-catalog"
import { env } from "../../env"
import { logger } from "../logger"

const SPEC_TTL_MS = 30_000

/**
 * The worker process's one spec loader, created on first use: importing this
 * module must not require `NEXT_PUBLIC_BUILDER_URL` (unit tests import the
 * handler graph without a builder deployment). `masterAgent.*` operations are
 * excluded: the agent driving the catalog must never call back into the chat
 * that spawned it — a `masterAgent.sendMessage` call from inside a turn would
 * queue a turn that queues a turn.
 */
let specLoader: ReturnType<typeof createSpecLoader> | undefined

const getSpecLoader = () => {
  if (specLoader) {
    return specLoader
  }
  // The worker reaches the builder over its internal address, so tool calls
  // execute against that same base: the spec advertises the public origin
  // (`FORCE_PUBLIC_HTTPS`), which the worker cannot necessarily dial.
  const apiUrl = apiBaseUrlFromBuilderUrl(env.NEXT_PUBLIC_BUILDER_URL)
  specLoader = createSpecLoader({
    apiUrl,
    executionBaseUrl: apiUrl,
    ttlMs: SPEC_TTL_MS,
    httpTimeoutMs: 15_000,
    excludeOperationIdPrefixes: ["masterAgent."],
    log: (message) => {
      logger.warn({}, `[master-agent] catalog: ${message}`)
    },
  })
  return specLoader
}

export const loadMasterAgentCatalog = async (): Promise<DynamicTool[]> =>
  await getSpecLoader().refreshIfStale()

export const findCatalogToolByName = (name: string): DynamicTool | undefined =>
  getSpecLoader().getToolByName(name)

export const getMasterAgentCatalogTools = (): DynamicTool[] =>
  getSpecLoader().getTools()

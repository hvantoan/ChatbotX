import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { IntegrationOpenaiCompatibleModel } from "@inboxos.io/database/types"
import { secretTextAuthSchema } from "@inboxos.io/sdk"

class InvalidOpenaiCompatibleAuthError extends Error {
  constructor() {
    super("OpenAI-compatible provider auth config is invalid.")
    this.name = "InvalidOpenaiCompatibleAuthError"
  }
}

const SSE_DONE_SUFFIX_RE = /(?:\r?\n)*data:\s*\[DONE\]\s*$/i
const SSE_DATA_PREFIX_RE = /^data:\s*/i
const SSE_MULTILINE_DATA_RE = /\r?\ndata:\s*/i

function isStreamingRequestBody(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") {
    return false
  }
  try {
    const parsed = JSON.parse(body) as { stream?: unknown }
    return parsed?.stream === true
  } catch {
    return false
  }
}

function stripNonStreamSseWrapper(rawText: string): string | null {
  const trimmed = rawText.trim()
  if (!trimmed) {
    return null
  }
  let cleaned = trimmed.replace(SSE_DONE_SUFFIX_RE, "").trim()
  if (
    SSE_DATA_PREFIX_RE.test(cleaned) &&
    !SSE_MULTILINE_DATA_RE.test(cleaned)
  ) {
    cleaned = cleaned.replace(SSE_DATA_PREFIX_RE, "").trim()
  }
  if (!cleaned) {
    return null
  }
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    return null
  }
}

/**
 * Some OpenAI-compatible gateways return `content-type: text/event-stream` and
 * append a trailing `data: [DONE]` marker even on non-streaming `stream: false`
 * JSON responses, which causes `@ai-sdk/openai-compatible` JSON parsing to fail.
 */
export function createOpenaiCompatibleFetch(
  baseFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init)
    if (!response.ok || isStreamingRequestBody(init?.body)) {
      return response
    }

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? ""
    if (
      !(
        contentType.includes("text/event-stream") ||
        contentType.includes("text/plain")
      ) &&
      contentType !== ""
    ) {
      return response
    }

    const rawText = await response.text()
    const normalizedJson = stripNonStreamSseWrapper(rawText)
    const headers = new Headers(response.headers)
    if (normalizedJson !== null) {
      headers.set("content-type", "application/json; charset=utf-8")
      headers.delete("content-length")
      headers.delete("content-encoding")
      return new Response(normalizedJson, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }

    return new Response(rawText, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

function createOpenaiCompatibleProvider(
  integration: IntegrationOpenaiCompatibleModel,
) {
  const authParsed = secretTextAuthSchema.safeParse(integration.auth)
  if (integration.auth !== null && !authParsed.success) {
    throw new InvalidOpenaiCompatibleAuthError()
  }
  const apiKey = authParsed.success ? authParsed.data.secretText : undefined
  const transformRequestBody =
    integration.preset === "nearai"
      ? (body: Record<string, unknown>) => {
          const { reasoning_effort, ...rest } = body
          return rest
        }
      : undefined

  const provider = createOpenAICompatible({
    name: integration.preset || "openai-compatible",
    baseURL: integration.baseURL,
    apiKey,
    fetch: createOpenaiCompatibleFetch(),
    ...(transformRequestBody ? { transformRequestBody } : {}),
  })

  return provider
}

export function createOpenaiCompatibleModelInstance(props: {
  integration: IntegrationOpenaiCompatibleModel
  modelId: string
}) {
  const { integration, modelId } = props
  return createOpenaiCompatibleProvider(integration)(modelId)
}

export function createOpenaiCompatibleEmbeddingModelInstance(props: {
  integration: IntegrationOpenaiCompatibleModel
  modelId: string
}) {
  const { integration, modelId } = props
  return createOpenaiCompatibleProvider(integration).embeddingModel(modelId)
}

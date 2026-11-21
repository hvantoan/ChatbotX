import { z } from "zod"
import { ZaloPersonalAPIException } from "../exception"

const getGatewayUrl = (): string =>
  process.env.ZALO_PERSONAL_GATEWAY_URL ?? "http://localhost:3220"

const getGatewayToken = (): string =>
  process.env.ZALO_PERSONAL_GATEWAY_TOKEN ?? ""

const TRAILING_SLASHES = /\/+$/

async function gatewayFetch<T>(
  path: string,
  options: {
    method?: "GET" | "POST"
    body?: unknown
  },
  schema: z.ZodType<T>,
): Promise<T> {
  const baseUrl = getGatewayUrl().replace(TRAILING_SLASHES, "")
  const token = getGatewayToken()
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new ZaloPersonalAPIException(
      `Zalo Personal Gateway error (${res.status}): ${text || res.statusText}`,
      res.status,
    )
  }

  const json: unknown = await res.json()
  return schema.parse(json)
}

export const gatewayClient = {
  sendMessage: (input: {
    zaloUid: string
    threadId: string
    threadType: "user" | "group"
    text?: string
    attachments?: Array<{
      url: string
      filename: string
      fileType: "image" | "video" | "audio" | "file"
    }>
  }) =>
    gatewayFetch(
      "/messages/send",
      { method: "POST", body: input },
      z.object({ messageIds: z.array(z.string()) }),
    ),

  getAccountStatus: (zaloUid: string) =>
    gatewayFetch(
      `/accounts/${encodeURIComponent(zaloUid)}/status`,
      { method: "GET" },
      z.object({
        zaloUid: z.string(),
        state: z.enum(["connecting", "connected", "disconnected", "error"]),
        reconnectAttempts: z.number(),
        lastError: z.string().optional(),
      }),
    ),

  stopAccount: (zaloUid: string) =>
    gatewayFetch(
      "/accounts/stop",
      { method: "POST", body: { zaloUid } },
      z.object({ ok: z.boolean() }),
    ),

  syncAccount: (zaloUid: string) =>
    gatewayFetch(
      `/accounts/${encodeURIComponent(zaloUid)}/sync`,
      { method: "POST" },
      z.object({ ok: z.boolean() }),
    ),
}

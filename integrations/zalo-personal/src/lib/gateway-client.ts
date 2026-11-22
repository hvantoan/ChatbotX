import { z } from "zod"
import { ZaloPersonalAPIException } from "../exception"

const getGatewayUrl = (): string =>
  process.env.ZALO_PERSONAL_GATEWAY_URL ?? "http://localhost:3220"

const getGatewayToken = (): string =>
  process.env.ZALO_PERSONAL_GATEWAY_TOKEN ?? ""

const TRAILING_SLASHES = /\/+$/

/**
 * The URL the gateway posts a session's messages to. Builder (connect) and
 * worker (session restore) both register it, so it is built in one place
 * from the caller's public origin.
 */
export function buildZaloPersonalWebhookUrl(
  origin: string,
  zaloUid: string,
): string {
  const url = new URL("/integrations/zalo_personal/webhook", origin)
  url.searchParams.set("zaloUid", zaloUid)
  return url.toString()
}

const SESSION_NOT_CONNECTED_CODE = "session_not_connected"

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
    if (res.status === 409 && text.includes(SESSION_NOT_CONNECTED_CODE)) {
      throw new ZaloPersonalAPIException(
        "Zalo Personal account is not connected on the gateway yet. It reconnects automatically within about a minute; resend afterwards.",
        409,
      )
    }
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
        tracked: z.boolean().optional(),
        state: z.enum(["connecting", "connected", "disconnected", "error"]),
        reconnectAttempts: z.number(),
        lastError: z.string().optional(),
      }),
    ),

  startAccount: (input: {
    integrationId: string
    zaloUid: string
    credentials: { imei: string; cookie: unknown; userAgent: string }
    webhookUrl: string
    webhookSecret: string
    proxyUrl?: string
  }) =>
    gatewayFetch(
      "/accounts/start",
      { method: "POST", body: input },
      z.object({
        zaloUid: z.string(),
        state: z.enum(["connecting", "connected", "disconnected", "error"]),
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

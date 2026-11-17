import { z } from "zod"
import { getBrokerOrigin } from "@/lib/oauth-broker"

const getGatewayUrl = (): string =>
  process.env.ZALO_PERSONAL_GATEWAY_URL ?? "http://localhost:3220"

const getGatewayToken = (): string =>
  process.env.ZALO_PERSONAL_GATEWAY_TOKEN ?? ""

export const getZaloPersonalWebhookSecret = (): string =>
  process.env.ZALO_PERSONAL_WEBHOOK_SECRET ?? ""

export function buildZaloPersonalWebhookUrl(zaloUid: string): string {
  const url = new URL("/integrations/zalo_personal/webhook", getBrokerOrigin())
  url.searchParams.set("zaloUid", zaloUid)
  return url.toString()
}

const TRAILING_SLASHES = /\/+$/

async function callGateway<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown },
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
    throw new Error(
      `Zalo Personal Gateway error (${res.status}): ${text || res.statusText}`,
    )
  }

  const json: unknown = await res.json()
  return schema.parse(json)
}

const qrStatusSchema = z.object({
  sessionId: z.string(),
  status: z.enum(["pending", "scanned", "confirmed", "expired", "error"]),
  scannedUser: z
    .object({
      displayName: z.string(),
      avatar: z.string().optional(),
    })
    .optional(),
  credentials: z
    .object({
      imei: z.string(),
      cookie: z.unknown(),
      userAgent: z.string(),
      zaloUid: z.string(),
      displayName: z.string(),
      avatar: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
})

export const zaloPersonalGateway = {
  startQr: (proxyUrl?: string) =>
    callGateway(
      "/qr/start",
      {
        method: "POST",
        body: proxyUrl ? { proxyUrl } : {},
      },
      z.object({
        sessionId: z.string(),
        status: z.enum(["pending", "scanned", "confirmed", "expired", "error"]),
        qrImageBase64: z.string(),
      }),
    ),

  getQrStatus: (sessionId: string) =>
    callGateway(
      `/qr/status?sessionId=${encodeURIComponent(sessionId)}`,
      { method: "GET" },
      qrStatusSchema,
    ),

  verifyCredentials: (input: {
    credentials: { imei: string; cookie: unknown; userAgent: string }
    proxyUrl?: string
  }) =>
    callGateway(
      "/accounts/verify",
      { method: "POST", body: input },
      z.object({
        zaloUid: z.string(),
        displayName: z.string(),
        avatar: z.string().optional(),
      }),
    ),

  startAccount: (input: {
    integrationId: string
    zaloUid: string
    credentials: { imei: string; cookie: unknown; userAgent: string }
    proxyUrl?: string
  }) => {
    const webhookSecret = getZaloPersonalWebhookSecret()
    return callGateway(
      "/accounts/start",
      {
        method: "POST",
        body: {
          ...input,
          webhookUrl: buildZaloPersonalWebhookUrl(input.zaloUid),
          ...(webhookSecret ? { webhookSecret } : {}),
        },
      },
      z.object({
        zaloUid: z.string(),
        state: z.enum(["connecting", "connected", "disconnected", "error"]),
      }),
    )
  },

  stopAccount: (zaloUid: string) =>
    callGateway(
      "/accounts/stop",
      { method: "POST", body: { zaloUid } },
      z.object({ ok: z.boolean() }),
    ),
}

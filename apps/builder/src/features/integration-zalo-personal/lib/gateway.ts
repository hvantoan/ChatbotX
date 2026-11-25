import { buildZaloPersonalWebhookUrl as buildWebhookUrl } from "@inboxos.io/integration-zalo-personal"
import { z } from "zod"
import { getBrokerOrigin } from "@/lib/oauth-broker"

const getGatewayUrl = (): string =>
  process.env.ZALO_PERSONAL_GATEWAY_URL ?? "http://localhost:3220"

const getGatewayToken = (): string =>
  process.env.ZALO_PERSONAL_GATEWAY_TOKEN ?? ""

export function buildZaloPersonalWebhookUrl(zaloUid: string): string {
  return buildWebhookUrl(getBrokerOrigin(), zaloUid)
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

export type ZaloPersonalQrStatus = z.infer<typeof qrStatusSchema>

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
    webhookSecret: string
    proxyUrl?: string
  }) =>
    callGateway(
      "/accounts/start",
      {
        method: "POST",
        body: {
          ...input,
          webhookUrl: buildZaloPersonalWebhookUrl(input.zaloUid),
        },
      },
      z.object({
        zaloUid: z.string(),
        state: z.enum(["connecting", "connected", "disconnected", "error"]),
      }),
    ),

  stopAccount: (zaloUid: string) =>
    callGateway(
      "/accounts/stop",
      { method: "POST", body: { zaloUid } },
      z.object({ ok: z.boolean() }),
    ),

  listFriends: (zaloUid: string) =>
    callGateway(
      `/accounts/${encodeURIComponent(zaloUid)}/friends`,
      { method: "GET" },
      z.object({
        friends: z.array(
          z.object({
            userId: z.string(),
            displayName: z.string(),
            avatar: z.string().optional(),
            phoneNumber: z.string().optional(),
          }),
        ),
      }),
    ),

  syncAccount: (zaloUid: string) =>
    callGateway(
      `/accounts/${encodeURIComponent(zaloUid)}/sync`,
      { method: "POST" },
      z.object({ ok: z.boolean() }),
    ),
}

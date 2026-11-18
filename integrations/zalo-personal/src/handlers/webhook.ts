import type { HandleRequestProps } from "@chatbotx.io/sdk"
import { timingSafeStringEqual } from "@chatbotx.io/utils/crypto"
import { ZaloPersonalWebhookException } from "../exception"
import {
  type ZaloPersonalConfig,
  type ZaloPersonalGroupReplyConfig,
  type ZaloPersonalWebhookPayload,
  zaloPersonalWebhookPayloadSchema,
} from "../schema"

async function computeHmacSha256Hex(
  secret: string,
  payload: string,
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  )
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export function shouldProcessGroupMessage(
  payload: ZaloPersonalWebhookPayload,
  groupReplyConfig?: ZaloPersonalGroupReplyConfig,
): boolean {
  if (payload.threadType !== "group") {
    return true
  }

  const mode = groupReplyConfig?.mode ?? "all"
  switch (mode) {
    case "disabled":
      return false
    case "mentions":
      return payload.isMentionedMe
    case "allowlist":
      return (groupReplyConfig?.allowedGroupIds ?? []).includes(
        payload.threadId,
      )
    default:
      return true
  }
}

export const webhookHandler = async (
  props: HandleRequestProps<ZaloPersonalConfig>,
): Promise<string> => {
  const { req, config, queue } = props
  const body = await req.text()
  if (!body) {
    throw new ZaloPersonalWebhookException("Empty webhook payload")
  }

  // Fail closed: without a secret the payload is unverifiable, and accepting
  // it would let anyone who learns the webhook URL forge messages.
  if (!config.webhookSecret) {
    throw new ZaloPersonalWebhookException("Missing webhook secret")
  }
  const presentedSig = req.headers.get("X-Zalo-Personal-Signature")
  const expectedSig = await computeHmacSha256Hex(config.webhookSecret, body)
  if (!(presentedSig && timingSafeStringEqual(presentedSig, expectedSig))) {
    throw new ZaloPersonalWebhookException("Invalid webhook signature")
  }

  const payload = zaloPersonalWebhookPayloadSchema.parse(JSON.parse(body))
  if (payload.isSelf) {
    return "ok"
  }

  if (!shouldProcessGroupMessage(payload, config.groupReplyConfig)) {
    return "ok"
  }

  await queue?.add("incomingMessage", {
    type: "incomingMessage",
    data: {
      integrationType: "zalo_personal",
      integrationIdentifier: config.zaloUid ?? payload.zaloUid,
      payload,
    },
  })

  return "ok"
}

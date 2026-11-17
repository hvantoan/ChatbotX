import { randomBytes } from "node:crypto"
import { integrationZaloPersonalService } from "@chatbotx.io/business"
import type { ZaloPersonalGroupReplyConfig } from "@chatbotx.io/database/schema"
import { logger } from "@/lib/log"
import { zaloPersonalGateway } from "./gateway"

export async function connectZaloPersonalWithCredentials(input: {
  workspaceId: string
  name: string
  zaloUid?: string
  avatar?: string
  proxyUrl?: string | null
  groupReplyConfig?: ZaloPersonalGroupReplyConfig
  credentials: {
    imei: string
    cookie: unknown
    userAgent: string
  }
}) {
  const proxyUrl = input.proxyUrl || undefined
  let zaloUid = input.zaloUid
  let avatar = input.avatar

  if (!zaloUid) {
    const verified = await zaloPersonalGateway.verifyCredentials({
      credentials: input.credentials,
      ...(proxyUrl ? { proxyUrl } : {}),
    })
    zaloUid = verified.zaloUid
    avatar = avatar ?? verified.avatar
  }

  const webhookSecret = randomBytes(24).toString("hex")

  const created = await integrationZaloPersonalService.connect({
    workspaceId: input.workspaceId,
    name: input.name,
    zaloUid,
    avatar: avatar ?? null,
    proxyUrl: proxyUrl ?? null,
    webhookSecret,
    groupReplyConfig: input.groupReplyConfig ?? { mode: "all" },
    credentials: input.credentials,
  })

  try {
    await zaloPersonalGateway.startAccount({
      integrationId: created.id,
      zaloUid: created.zaloUid,
      credentials: input.credentials,
      ...(proxyUrl ? { proxyUrl } : {}),
    })
  } catch (err) {
    logger.error(
      { err, integrationId: created.id, zaloUid: created.zaloUid },
      "Failed to start Zalo personal gateway listener after connect",
    )
  }

  return created
}

export async function updateZaloPersonalChannel(input: {
  workspaceId: string
  id: string
  name?: string
  proxyUrl?: string | null
  groupReplyConfig?: ZaloPersonalGroupReplyConfig
}) {
  const updated = await integrationZaloPersonalService.updateSettings({
    id: input.id,
    workspaceId: input.workspaceId,
    name: input.name,
    proxyUrl: input.proxyUrl,
    groupReplyConfig: input.groupReplyConfig,
  })
  return updated
}

export async function disconnectZaloPersonalChannel(input: {
  workspaceId: string
  id: string
}): Promise<void> {
  const deleted = await integrationZaloPersonalService.delete({
    id: input.id,
    workspaceId: input.workspaceId,
  })
  if (deleted) {
    try {
      await zaloPersonalGateway.stopAccount(deleted.zaloUid)
    } catch (err) {
      logger.warn(
        { err, zaloUid: deleted.zaloUid },
        "Failed to stop Zalo personal gateway listener on disconnect",
      )
    }
  }
}

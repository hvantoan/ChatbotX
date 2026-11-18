import type { BaseConfig, CustomAuthValue } from "@chatbotx.io/sdk"
import { z } from "zod"

export const zaloPersonalGroupReplyConfigSchema = z.object({
  mode: z.enum(["all", "mentions", "allowlist", "disabled"]),
  allowedGroupIds: z.array(z.string()).optional(),
})
export type ZaloPersonalGroupReplyConfig = z.infer<
  typeof zaloPersonalGroupReplyConfigSchema
>

export type ZaloPersonalConfig = BaseConfig & {
  zaloUid?: string
  webhookSecret?: string
  groupReplyConfig?: ZaloPersonalGroupReplyConfig
  stateParams?: {
    workspaceId: string
  }
}

export type ZaloPersonalAuthValue = CustomAuthValue & {
  zaloUid: string
  proxyUrl?: string
  webhookSecret?: string
  encryptedCredentials?: unknown
}

export type ZaloPersonalActions = Record<string, never>

export const zaloPersonalWebhookAttachmentSchema = z.object({
  type: z.enum(["image", "video", "audio", "file"]),
  url: z.string(),
  name: z.string().optional(),
})
export type ZaloPersonalWebhookAttachment = z.infer<
  typeof zaloPersonalWebhookAttachmentSchema
>

export const zaloPersonalWebhookPayloadSchema = z.object({
  zaloUid: z.string().min(1),
  integrationId: z.string().min(1),
  threadId: z.string().min(1),
  threadType: z.enum(["user", "group"]),
  senderId: z.string().min(1),
  senderName: z.string(),
  messageId: z.string().min(1),
  text: z.string(),
  attachments: z.array(zaloPersonalWebhookAttachmentSchema),
  isMentionedMe: z.boolean(),
  isSelf: z.boolean(),
  timestamp: z.number(),
})
export type ZaloPersonalWebhookPayload = z.infer<
  typeof zaloPersonalWebhookPayloadSchema
>

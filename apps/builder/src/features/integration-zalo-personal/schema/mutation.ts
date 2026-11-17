import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

export const zaloPersonalGroupReplyConfigSchema = z.object({
  mode: z.enum(["all", "mentions", "allowlist", "disabled"]),
  allowedGroupIds: z.array(z.string()).optional(),
})

export const startZaloPersonalQrSchema = z.object({
  proxyUrl: z.string().url().optional().or(z.literal("")),
})

export const pollZaloPersonalQrSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(60),
  proxyUrl: z.string().url().optional().or(z.literal("")),
  groupReplyConfig: zaloPersonalGroupReplyConfigSchema.optional(),
})

export const connectZaloPersonalCredentialsSchema = z.object({
  name: z.string().min(1).max(60),
  imei: z.string().min(1),
  cookie: z.string().min(2),
  userAgent: z.string().min(1),
  proxyUrl: z.string().url().optional().or(z.literal("")),
  groupReplyConfig: zaloPersonalGroupReplyConfigSchema.optional(),
})

export const updateZaloPersonalSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  proxyUrl: z.string().url().nullable().optional().or(z.literal("")),
  groupReplyConfig: zaloPersonalGroupReplyConfigSchema.optional(),
})

export const zaloPersonalChannelIdRequest = z.object({
  id: zodBigintAsString(),
})

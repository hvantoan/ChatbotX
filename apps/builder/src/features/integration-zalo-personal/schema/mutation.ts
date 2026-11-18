import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

export const zaloPersonalGroupReplyConfigSchema = z
  .object({
    mode: z
      .enum(["all", "mentions", "allowlist", "disabled"])
      .describe(
        "Group reply filter: reply everywhere, only when mentioned, only in the listed groups, or nowhere.",
      ),
    allowedGroupIds: z
      .array(z.string())
      .optional()
      .describe("Group ids allowed to trigger replies when mode is allowlist."),
  })
  .describe("Group reply filter applied to group messages.")

export const startZaloPersonalQrSchema = z.object({
  proxyUrl: z
    .string()
    .url()
    .optional()
    .or(z.literal(""))
    .describe(
      "Optional http(s) proxy URL for this account's Zalo traffic (may carry proxy credentials).",
    ),
})

export const pollZaloPersonalQrSchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(60),
  proxyUrl: z.string().url().optional().or(z.literal("")),
  groupReplyConfig: zaloPersonalGroupReplyConfigSchema.optional(),
})

export const connectZaloPersonalCredentialsSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .describe("Display name for the channel in this workspace."),
  imei: z
    .string()
    .min(1)
    .describe(
      "IMEI generated for this Zalo client session (from the QR login flow).",
    ),
  cookie: z
    .string()
    .min(2)
    .describe(
      "Zalo session cookie JSON captured from the QR login flow; stored encrypted and never returned.",
    ),
  userAgent: z
    .string()
    .min(1)
    .describe(
      "User-Agent string matching the session that issued the credentials.",
    ),
  proxyUrl: z
    .string()
    .url()
    .optional()
    .or(z.literal(""))
    .describe(
      "Optional http(s) proxy URL for this account's Zalo traffic (may carry proxy credentials).",
    ),
  groupReplyConfig: zaloPersonalGroupReplyConfigSchema.optional(),
})

export const updateZaloPersonalSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe("New display name for the channel; omit to leave unchanged."),
  proxyUrl: z
    .string()
    .url()
    .nullable()
    .optional()
    .or(z.literal(""))
    .describe(
      "New http(s) proxy URL for this account's Zalo traffic; null or empty clears it, omit to leave unchanged.",
    ),
  groupReplyConfig: zaloPersonalGroupReplyConfigSchema.optional(),
})

export const zaloPersonalChannelIdRequest = z.object({
  id: zodBigintAsString().describe(
    "Zalo Personal channel (integration) id, e.g. from zaloPersonalChannels.list.",
  ),
})

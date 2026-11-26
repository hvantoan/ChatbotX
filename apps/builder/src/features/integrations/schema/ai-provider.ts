import { openaiCompatibleProviderPresets } from "@inboxos.io/ai"
import { zodBigintIdAsString } from "@inboxos.io/utils"
import { z } from "zod"

export const legacyAiProviderPathParam = z.enum([
  "claude",
  "deepseek",
  "gemini",
  "muse",
  "openai",
])
export type LegacyAiProviderPathParam = z.infer<
  typeof legacyAiProviderPathParam
>

export const aiProviderPathParam = z.enum([
  "claude",
  "deepseek",
  "gemini",
  "muse",
  "openai",
  "openaiCompatible",
])
export type AiProviderPathParam = z.infer<typeof aiProviderPathParam>

export const legacyAiProviderRequest = z.object({
  provider: legacyAiProviderPathParam.describe("AI provider identifier."),
})

export const getAiProviderRequest = z
  .object({
    provider: aiProviderPathParam.describe("AI provider identifier."),
    integrationId: zodBigintIdAsString()
      .optional()
      .describe(
        "OpenAI-compatible only: optional satellite `id` (or parent `connection.integrationId`) to filter to a single OpenAI-compatible integration.",
      ),
  })
  .superRefine((value, ctx) => {
    if (
      value.provider !== "openaiCompatible" &&
      value.integrationId !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["integrationId"],
        message:
          "integrationId is only supported when provider is openaiCompatible",
      })
    }
  })

const openaiCompatibleBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const parsed = new URL(value)
      return parsed.protocol === "http:" || parsed.protocol === "https:"
    } catch {
      return false
    }
  }, "OpenAI-compatible base URL must be a valid HTTP or HTTPS URL.")

export const updateAiProviderRequest = z
  .object({
    provider: aiProviderPathParam.describe("AI provider identifier."),
    integrationId: zodBigintIdAsString()
      .optional()
      .describe(
        "Required when `provider` is `openaiCompatible`. Satellite `id` from `integrations.getAiProvider` (or parent `connection.integrationId`).",
      ),
    autoReply: z
      .boolean()
      .optional()
      .describe(
        "AI Reply switch. When true, the provider answers inbound messages automatically. Omit to leave it unchanged.",
      ),
    enabled: z
      .boolean()
      .optional()
      .describe(
        "OpenAI-compatible only: whether this provider is enabled for AI agents and flows.",
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe("OpenAI-compatible only: display name."),
    preset: openaiCompatibleProviderPresets
      .optional()
      .describe(
        "OpenAI-compatible only: preset identifier (e.g. `lmstudio`, `nim`, `clarifai`, `nearai`, `heroku`, `custom`).",
      ),
    defaultModel: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe("OpenAI-compatible only: default model name."),
    baseURL: openaiCompatibleBaseUrlSchema
      .optional()
      .describe(
        "OpenAI-compatible only: endpoint base URL (re-checked against the SSRF guard; changing origin requires providing `apiKey`).",
      ),
    apiKey: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("OpenAI-compatible only: replacement API key."),
  })
  .superRefine((value, ctx) => {
    if (value.provider === "openaiCompatible") {
      if (!value.integrationId) {
        ctx.addIssue({
          code: "custom",
          path: ["integrationId"],
          message:
            "integrationId is required when provider is openaiCompatible",
        })
      }
      return
    }

    const compatibleOnlyFields = [
      "integrationId",
      "enabled",
      "name",
      "preset",
      "defaultModel",
      "baseURL",
      "apiKey",
    ] as const
    for (const field of compatibleOnlyFields) {
      if (value[field] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is only supported when provider is openaiCompatible`,
        })
      }
    }
  })

// Never includes `auth` — the encrypted/secret credential. Only `hasApiKey`
// (a boolean) signals whether a key is configured; the raw secret must never
// reach a public API response.
export const publicAiProviderResource = z.object({
  id: z.string(),
  model: z.string(),
  temperature: z.number().nullable(),
  maxOutputTokens: z.number(),
  autoReply: z.boolean(),
  hasApiKey: z.boolean(),
})

export const openaiCompatibleAiProviderResource = z.object({
  id: z
    .string()
    .describe(
      "Satellite integration id — pass this as `integrationId` in `aiAgents.create` and `integrations.updateAiProvider`.",
    ),
  integrationId: z
    .string()
    .describe("Parent integration id matching `connection.integrationId`."),
  name: z.string(),
  preset: z.string(),
  baseURL: z.string(),
  defaultModel: z.string(),
  enabled: z.boolean(),
  autoReply: z.boolean(),
  hasApiKey: z.boolean(),
})

export const getAiProviderResponse = z.union([
  publicAiProviderResource.describe(
    "Single-instance AI provider configuration.",
  ),
  z
    .object({
      data: z.array(openaiCompatibleAiProviderResource),
    })
    .describe("Connected OpenAI-compatible provider configurations."),
])

export const updateAiProviderResponse = z.union([
  publicAiProviderResource.describe(
    "Updated single-instance AI provider configuration.",
  ),
  openaiCompatibleAiProviderResource.describe(
    "Updated OpenAI-compatible provider configuration.",
  ),
])

export const connectAiProviderRequest = z.object({
  apiKey: z.string().min(1).describe("Provider API key."),
  model: z
    .string()
    .min(1)
    .describe("Model identifier to use for this provider."),
  temperature: z.coerce
    .number()
    .min(0)
    .max(2)
    .describe("Sampling temperature."),
  maxOutputTokens: z.coerce
    .number()
    .int()
    .min(1)
    .max(8192)
    .describe("Maximum tokens generated per response."),
})

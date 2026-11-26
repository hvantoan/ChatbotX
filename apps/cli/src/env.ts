import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"
import { applyLegacyEnvAliases } from "./env-alias"

// Copy CHATBOTX_* onto INBOXOS_* before the schema reads process.env.
applyLegacyEnvAliases()

export const env = createEnv({
  server: {
    INBOXOS_API_KEY: z.string().optional(),
    INBOXOS_API_URL: z.url().optional(),
    INBOXOS_ALLOW_SELF_SIGNED_CERT: z.enum(["true", "false"]).optional(),
  },
  runtimeEnv: process.env,
})

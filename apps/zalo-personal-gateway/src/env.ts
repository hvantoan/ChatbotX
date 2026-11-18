import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().default(3220),
    HOST: z.string().default("0.0.0.0"),
    ZALO_PERSONAL_GATEWAY_TOKEN: z.string().min(32),
    ZALO_PERSONAL_WEBHOOK_SECRET: z.string().min(16).optional(),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    ZALO_PERSONAL_PROXY_URL: z
      .string()
      .url()
      .optional()
      .or(z.literal(""))
      .transform((v) => (v === "" ? undefined : v)),
    ZALO_PERSONAL_MAX_ACCOUNTS: z.coerce.number().int().positive().default(5),
  },
  runtimeEnv: process.env,
  skipValidation: process.env.SKIP_ENV_CHECK === "true",
})

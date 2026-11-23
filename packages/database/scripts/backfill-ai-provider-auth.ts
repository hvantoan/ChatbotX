import { db } from "../src/client"
import {
  backfillAiProviderAuth,
  printBackfillResult,
} from "./backfill-ai-provider-auth/index"

export * from "./backfill-ai-provider-auth/auth-codec"
export * from "./backfill-ai-provider-auth/index"

const isMainModule =
  process.argv[1] === new URL(import.meta.url).pathname ||
  process.argv[1] === import.meta.url

if (isMainModule) {
  const apply = process.argv.slice(2).includes("--apply")
  backfillAiProviderAuth(db, { dryRun: !apply })
    .then((result) => {
      printBackfillResult(result)
      process.exit(0)
    })
    .catch((error) => {
      console.error("AI provider auth backfill failed:", error)
      process.exit(1)
    })
}

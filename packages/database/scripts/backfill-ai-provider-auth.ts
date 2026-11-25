/**
 * Encrypts legacy plaintext `auth` into `encryptedAuth` on the seven AI
 * provider tables (openai, claude, gemini, deepseek, muse, openrouter,
 * openaiCompatible).
 *
 * Usage:
 *   pnpm --filter @inboxos.io/database exec tsx scripts/backfill-ai-provider-auth.ts          # dry run (default)
 *   pnpm --filter @inboxos.io/database exec tsx scripts/backfill-ai-provider-auth.ts --apply  # writes
 *
 * Rolling-deploy order — do NOT run --apply until every builder and worker
 * runs the version whose readers resolve both `auth` and `encryptedAuth`:
 *   1. Deploy the dual-read version everywhere first. Until then, an old
 *      worker still reads plaintext `auth`, which ciphertext writes blank.
 *   2. Drain every pre-upgrade process that writes plaintext `auth`.
 *      Dual-read readers prefer a parseable plaintext `auth` over stale
 *      ciphertext, so a legacy write landing mid-deploy is honoured — but
 *      the row still needs a backfill pass to re-encrypt it.
 *   3. Run --apply, then re-run until every table reports conflicted=0: a
 *      `conflicted` row was replaced by a concurrent write and left
 *      untouched on purpose.
 */
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

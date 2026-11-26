import type { EncryptedData } from "@inboxos.io/encryption"
import { sql } from "drizzle-orm"
import type { DatabaseClient } from "../../src/client"
import {
  type AiAuthClassification,
  classifyAiAuth,
  encryptAiProviderAuth,
} from "./auth-codec"

export const BATCH_SIZE = 200

export type AiProviderName =
  | "openai"
  | "claude"
  | "gemini"
  | "deepseek"
  | "muse"
  | "openrouter"
  | "openaiCompatible"

export const AI_PROVIDER_TABLES: readonly {
  provider: AiProviderName
  table: string
}[] = [
  { provider: "openai", table: "IntegrationOpenai" },
  { provider: "claude", table: "IntegrationClaude" },
  { provider: "gemini", table: "IntegrationGemini" },
  { provider: "deepseek", table: "IntegrationDeepseek" },
  { provider: "muse", table: "IntegrationMuse" },
  { provider: "openrouter", table: "IntegrationOpenrouter" },
  { provider: "openaiCompatible", table: "IntegrationOpenaiCompatible" },
]

export type AiProviderBackfillStat = {
  provider: AiProviderName
  scanned: number
  encrypted: number
  alreadyEncrypted: number
  skipped: number
  /**
   * Rows whose selected plaintext was replaced (or already encrypted) by a
   * concurrent write before the UPDATE committed. They still hold plaintext
   * (or fresh ciphertext) and are picked up again on the next run — a
   * non-zero count means "re-run the backfill", not data loss.
   */
  conflicted: number
}

export type BackfillAiProviderAuthOptions = {
  dryRun?: boolean
  batchSize?: number
}

export type BackfillAiProviderAuthResult = {
  dryRun: boolean
  stats: AiProviderBackfillStat[]
  totalEncrypted: number
}

type AuthRow = {
  id: string
  workspaceId: string
  auth: unknown
  encryptedAuth: unknown
}

const selectBatch = async (
  client: DatabaseClient,
  table: string,
  cursor: string | null,
  batchSize: number,
): Promise<AuthRow[]> => {
  const result = await client.execute<AuthRow>(sql`
    SELECT id, "workspaceId", auth, "encryptedAuth"
    FROM ${sql.identifier(table)}
    WHERE "encryptedAuth" IS NULL AND auth IS NOT NULL
    ${cursor === null ? sql`` : sql`AND id > ${cursor}`}
    ORDER BY id
    LIMIT ${batchSize}
  `)
  return result.rows
}

export type AiAuthPlan =
  | { action: "encrypt"; encryptedAuth: EncryptedData }
  | { action: "skip"; reason: AiAuthClassification }

export const planAiAuthEncryption = async (
  row: { auth: unknown; encryptedAuth: unknown },
  provider: string,
  workspaceId: string,
): Promise<AiAuthPlan> => {
  if (row.encryptedAuth !== null && row.encryptedAuth !== undefined) {
    return { action: "skip", reason: "already-encrypted" }
  }
  const reason = classifyAiAuth(row.auth)
  if (reason !== "plaintext") {
    return { action: "skip", reason }
  }
  return {
    action: "encrypt",
    encryptedAuth: await encryptAiProviderAuth(provider, workspaceId, row.auth),
  }
}

export const backfillAiProviderAuth = async (
  client: DatabaseClient,
  options: BackfillAiProviderAuthOptions = {},
): Promise<BackfillAiProviderAuthResult> => {
  const dryRun = options.dryRun ?? true
  const batchSize = options.batchSize ?? BATCH_SIZE
  const stats: AiProviderBackfillStat[] = []

  for (const { provider, table } of AI_PROVIDER_TABLES) {
    const stat: AiProviderBackfillStat = {
      provider,
      scanned: 0,
      encrypted: 0,
      alreadyEncrypted: 0,
      skipped: 0,
      conflicted: 0,
    }
    let cursor: string | null = null

    for (;;) {
      const batch = await selectBatch(client, table, cursor, batchSize)
      if (batch.length === 0) {
        break
      }

      for (const row of batch) {
        stat.scanned += 1
        const plan = await planAiAuthEncryption(
          row,
          provider,
          String(row.workspaceId),
        )
        if (plan.action === "skip") {
          if (plan.reason === "already-encrypted") {
            stat.alreadyEncrypted += 1
          } else {
            stat.skipped += 1
          }
          continue
        }

        if (!dryRun) {
          // Write only if the row still matches what the SELECT read: no
          // ciphertext yet and the exact same plaintext. A credential replaced
          // through the public API mid-batch (or already encrypted by a
          // new-code writer) must not be overwritten with the stale copy — it
          // is counted as `conflicted` and re-encrypted on the next run.
          const updated = await client.execute<{ id: string }>(sql`
            UPDATE ${sql.identifier(table)}
            SET auth = '{}'::jsonb,
                "encryptedAuth" = ${JSON.stringify(plan.encryptedAuth)}::jsonb
            WHERE id = ${row.id}
              AND "encryptedAuth" IS NULL
              AND auth = ${JSON.stringify(row.auth)}::jsonb
            RETURNING id
          `)
          if (updated.rows.length === 0) {
            stat.conflicted += 1
            continue
          }
        }
        stat.encrypted += 1
      }

      const lastRow = batch.at(-1)
      if (!lastRow || batch.length < batchSize) {
        break
      }
      cursor = String(lastRow.id)
    }

    stats.push(stat)
  }

  return {
    dryRun,
    stats,
    totalEncrypted: stats.reduce((sum, stat) => sum + stat.encrypted, 0),
  }
}

export const printBackfillResult = (
  result: BackfillAiProviderAuthResult,
): void => {
  console.log(
    `AI provider auth backfill ${result.dryRun ? "(dry run, no writes)" : ""} — per-table counts:`,
  )
  for (const stat of result.stats) {
    console.log(
      `  ${stat.provider}: scanned=${stat.scanned} ${result.dryRun ? "would-encrypt" : "encrypted"}=${stat.encrypted} already-encrypted=${stat.alreadyEncrypted} skipped=${stat.skipped} conflicted=${stat.conflicted}`,
    )
  }
  const conflicted = result.stats.reduce(
    (sum, stat) => sum + stat.conflicted,
    0,
  )
  if (conflicted > 0) {
    console.log(
      `${conflicted} rows changed mid-run and were left untouched — re-run the backfill to encrypt them.`,
    )
  }
  console.log(
    `Total ${result.dryRun ? "would-encrypt" : "encrypted"}: ${result.totalEncrypted}`,
  )
  if (result.dryRun) {
    console.log(
      "\nDry run — re-run with --apply only after PO approval of the migration and these counts.",
    )
  }
}

/**
 * Re-encrypts all Credential rows AND every AI-provider `encryptedAuth`
 * column from the previous key to the current key.
 *
 * Usage:
 *   pnpm --filter @chatbotx.io/database rotate:encryption-key [--dry-run]
 *
 * Required env vars:
 *   ENCRYPTION_KEY      — the new (target) key hex
 *   ENCRYPTION_KEY_ID   — the new key's ID (e.g. "k2")
 *   ENCRYPTION_KEY_PREV — the previous key hex (used to decrypt existing rows)
 *
 * Workflow:
 *   1. Generate a new key:  openssl rand -hex 32
 *   2. Set ENCRYPTION_KEY_PREV=<old value of ENCRYPTION_KEY>
 *   3. Set ENCRYPTION_KEY=<new hex> and ENCRYPTION_KEY_ID=<new id>
 *   4. Run this script (--dry-run first to see row counts)
 *   5. Once complete, remove ENCRYPTION_KEY_PREV from env
 *
 * The script exits non-zero while any platform credential or AI-provider
 * `encryptedAuth` row is still bound to a previous key id, so operators know
 * ENCRYPTION_KEY_PREV must not be removed yet.
 */
import { encryptUtils } from "@chatbotx.io/encryption"
import { eq, sql } from "drizzle-orm"
import type { z } from "zod"
import { db } from "../src/client"
import {
  type CredentialByType,
  type CredentialType,
  credentialAadFor,
  credentialEncryptedSchema,
  credentialSchemas,
} from "../src/partials/credential"
import { platformCredentialModel } from "../src/schema/platform-credential"
import { aiProviderAuthAad } from "./backfill-ai-provider-auth/auth-codec"
import { AI_PROVIDER_TABLES } from "./backfill-ai-provider-auth/index"

const isDryRun = process.argv.includes("--dry-run")
const activeKid = process.env.ENCRYPTION_KEY_ID ?? "default"

type AiProviderAuthRow = {
  id: string
  workspaceId: string
  encryptedAuth: unknown
}

const selectAiProviderRows = async (
  table: string,
): Promise<AiProviderAuthRow[]> =>
  (
    await db.execute<AiProviderAuthRow>(sql`
      SELECT id, "workspaceId", "encryptedAuth"
      FROM ${sql.identifier(table)}
      WHERE "encryptedAuth" IS NOT NULL
    `)
  ).rows

/**
 * Rows still carrying a blob that does NOT decrypt under the active key —
 * either a previous `kid` or a value that is not a ciphertext blob at all.
 * Operators must not drop ENCRYPTION_KEY_PREV while this is non-zero.
 */
const countUnrotated = (rows: { encryptedAuth: unknown }[]): number =>
  rows.filter((row) => {
    const result = credentialEncryptedSchema.safeParse(row.encryptedAuth)
    return !(result.success && result.data.kid === activeKid)
  }).length

const rotateAiProviderAuth = async (): Promise<{
  rotated: number
  errors: number
  remaining: number
}> => {
  let rotated = 0
  let errors = 0
  let remaining = 0

  for (const { provider, table } of AI_PROVIDER_TABLES) {
    const rows = await selectAiProviderRows(table)
    const toRotate = rows.filter((row) => {
      const result = credentialEncryptedSchema.safeParse(row.encryptedAuth)
      return result.success && result.data.kid !== activeKid
    })

    console.log(
      `${table}: ${toRotate.length} of ${rows.length} ciphertext rows to rotate → kid="${activeKid}".`,
    )

    if (isDryRun) {
      continue
    }

    for (const row of toRotate) {
      try {
        const blob = credentialEncryptedSchema.parse(row.encryptedAuth)
        const aad = aiProviderAuthAad(provider, String(row.workspaceId))
        // decryptText/encryptText round-trips the raw payload: the stored
        // auth schema may legitimately differ between provider versions and
        // must never block a key rotation.
        const text = await encryptUtils.decryptText(blob, aad)
        const newValue = await encryptUtils.encryptText(text, aad)

        // Guard on the exact blob we decrypted so a concurrent write is
        // never overwritten — the recount below surfaces any row this skips.
        const updated = await db.execute<{ id: string }>(sql`
          UPDATE ${sql.identifier(table)}
          SET "encryptedAuth" = ${JSON.stringify(newValue)}::jsonb
          WHERE id = ${row.id}
            AND "encryptedAuth" = ${JSON.stringify(row.encryptedAuth)}::jsonb
          RETURNING id
        `)
        if (updated.rows.length > 0) {
          rotated++
        }
      } catch (error) {
        console.error(`[${table} id:${row.id}] Failed:`, error)
        errors++
      }
    }

    const after = await selectAiProviderRows(table)
    const tableRemaining = countUnrotated(after)
    remaining += tableRemaining
    if (tableRemaining > 0) {
      console.error(
        `${table}: ${tableRemaining} rows still bound to a previous key.`,
      )
    }
  }

  return { rotated, errors, remaining }
}

const main = async (): Promise<void> => {
  if (!process.env.ENCRYPTION_KEY_PREV) {
    console.error(
      "Error: ENCRYPTION_KEY_PREV must be set to the previous encryption key.",
    )
    process.exit(1)
  }

  const rows = await db.select().from(platformCredentialModel)

  const toRotate = rows.filter((row) => {
    const result = credentialEncryptedSchema.safeParse(row.value)
    return result.success && result.data.kid !== activeKid
  })

  console.log(
    `Found ${toRotate.length} of ${rows.length} PlatformCredential rows to rotate → kid="${activeKid}".`,
  )

  if (isDryRun) {
    await rotateAiProviderAuth()
    console.log("Dry run — no changes written.")
    return
  }

  let rotated = 0
  let errors = 0

  for (const row of toRotate) {
    try {
      const blob = credentialEncryptedSchema.parse(row.value)
      const type = row.type as CredentialType
      const aad = credentialAadFor({ userId: row.userId, type })
      // SAFETY: `credentialSchemas` is keyed by `CredentialType`, so indexing
      // it with the row's own `type` yields exactly that credential's schema;
      // the union's mapped type just cannot narrow per-key through a lookup.
      const schema = credentialSchemas[type] as unknown as z.ZodType<
        CredentialByType[CredentialType]
      >

      const config = await encryptUtils.decryptObject(blob, schema, aad)
      const newValue = await encryptUtils.encryptObject(config, aad)

      await db
        .update(platformCredentialModel)
        .set({ value: newValue })
        .where(eq(platformCredentialModel.id, row.id))

      rotated++
    } catch (error) {
      console.error(
        `[id:${row.id} userId:${row.userId ?? "platform"} type:${row.type}] Failed:`,
        error,
      )
      errors++
    }
  }

  const aiResult = await rotateAiProviderAuth()
  rotated += aiResult.rotated
  errors += aiResult.errors

  console.log(
    `Rotation complete: ${rotated} rotated, ${errors} errors, ${aiResult.remaining} rows still on a previous key.`,
  )
  if (errors > 0 || aiResult.remaining > 0) {
    console.error(
      "Rows remain bound to a previous key — do NOT remove ENCRYPTION_KEY_PREV.",
    )
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Rotation failed:", error)
    process.exit(1)
  })

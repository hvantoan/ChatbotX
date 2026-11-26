import { db, eq } from "@inboxos.io/database/client"
import { channelTypes } from "@inboxos.io/database/partials"
import {
  integrationZaloPersonalModel,
  type ZaloPersonalGroupReplyConfig,
} from "@inboxos.io/database/schema"
import { type EncryptedData, encryptUtils } from "@inboxos.io/encryption"
import { createId } from "@inboxos.io/utils"
import { z } from "zod"
import { bulkImportChannelContacts } from "../contact/bulk-import-channel-contacts"
import { channelDuplicatedException } from "../errors"
import { inboxService } from "../inbox"

export const zaloPersonalRawCredentialsSchema = z.object({
  imei: z.string().min(1),
  cookie: z.unknown(),
  userAgent: z.string().min(1),
})
export type ZaloPersonalRawCredentials = z.infer<
  typeof zaloPersonalRawCredentialsSchema
>

export type ZaloPersonalFriend = {
  userId: string
  displayName: string
  avatar?: string
  phoneNumber?: string
}

// Friends per bulk-import call: bounds each insert transaction for accounts
// with thousands of friends.
const FRIEND_IMPORT_BATCH_SIZE = 500

export type SanitizedZaloPersonalIntegration = {
  id: string
  name: string
  zaloUid: string
  avatar: string | null
  proxyUrl: string | null
  groupReplyConfig: ZaloPersonalGroupReplyConfig | null
  inboxId: string
  workspaceId: string
  createdAt: Date
}

function toSanitized(
  row: typeof integrationZaloPersonalModel.$inferSelect,
): SanitizedZaloPersonalIntegration {
  return {
    id: row.id,
    name: row.name,
    zaloUid: row.zaloUid,
    avatar: row.avatar,
    proxyUrl: row.proxyUrl,
    groupReplyConfig: row.groupReplyConfig,
    inboxId: row.inboxId,
    workspaceId: row.workspaceId,
    createdAt: row.createdAt,
  }
}

export const integrationZaloPersonalService = {
  findByZaloUid: async (zaloUid: string) =>
    db.query.integrationZaloPersonalModel.findFirst({
      where: { zaloUid },
    }),

  /**
   * Every connected account, for the worker that restores gateway sessions
   * lost when the gateway process restarts. Ids only — credentials are
   * decrypted one account at a time via `getDecryptedCredentials`.
   */
  listForSessionRestore: async (): Promise<
    Array<{ id: string; workspaceId: string; zaloUid: string }>
  > =>
    db.query.integrationZaloPersonalModel.findMany({
      columns: { id: true, workspaceId: true, zaloUid: true },
      orderBy: { createdAt: "asc" },
    }),

  findById: async (input: { id: string; workspaceId: string }) => {
    const row = await db.query.integrationZaloPersonalModel.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    return row ? toSanitized(row) : null
  },

  listByWorkspaceId: async (
    workspaceId: string,
  ): Promise<SanitizedZaloPersonalIntegration[]> => {
    const rows = await db.query.integrationZaloPersonalModel.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    })
    return rows.map(toSanitized)
  },

  connect: async (input: {
    workspaceId: string
    name: string
    zaloUid: string
    avatar?: string | null
    proxyUrl?: string | null
    webhookSecret: string
    groupReplyConfig?: ZaloPersonalGroupReplyConfig
    credentials: ZaloPersonalRawCredentials
  }): Promise<SanitizedZaloPersonalIntegration> => {
    const encryptedCredentials = await encryptUtils.encryptObject(
      input.credentials,
      input.zaloUid,
    )

    const auth = {
      authType: "custom",
      zaloUid: input.zaloUid,
      webhookSecret: input.webhookSecret,
      ...(input.proxyUrl ? { proxyUrl: input.proxyUrl } : {}),
      encryptedCredentials,
    }

    // Global identity check BEFORE the transaction: `inboxService.create`
    // admits channel quota outside `tx`, so a unique-violation rollback on
    // the insert below would still leave that quota consumed. The common
    // case — this Zalo account already connected (any workspace) — is
    // rejected here without touching quota. A same-instant duplicate can
    // still race past this read, but the remaining window is negligible.
    if (
      await db.query.integrationZaloPersonalModel.findFirst({
        where: { zaloUid: input.zaloUid },
        columns: { id: true },
      })
    ) {
      throw channelDuplicatedException()
    }

    const workspace = await db.query.workspaceModel.findFirst({
      where: { id: input.workspaceId },
      columns: { ownerId: true },
    })

    const row = await db.transaction(async (tx) => {
      // `create` revives a disconnected inbox in place (keeping its contacts
      // and conversations) instead of colliding on the sourceId identity —
      // and a still-connected one means the account is already linked, which
      // surfaces as a friendly conflict rather than a raw unique violation.
      const { inbox, wasCreated } = await inboxService.create({
        tx,
        ownerId: workspace?.ownerId ?? input.workspaceId,
        data: {
          workspaceId: input.workspaceId,
          channel: channelTypes.enum.zalo_personal,
          sourceId: input.zaloUid,
          name: input.name,
        },
      })
      if (!wasCreated) {
        throw channelDuplicatedException()
      }

      const integrationId = createId()
      const [inserted] = await tx
        .insert(integrationZaloPersonalModel)
        .values({
          id: integrationId,
          workspaceId: input.workspaceId,
          inboxId: inbox.id,
          zaloUid: input.zaloUid,
          name: input.name,
          avatar: input.avatar ?? null,
          proxyUrl: input.proxyUrl ?? null,
          groupReplyConfig: input.groupReplyConfig ?? { mode: "all" },
          auth,
        })
        .returning()

      return inserted
    })

    return toSanitized(row)
  },

  getDecryptedCredentials: async (input: {
    id: string
    workspaceId: string
  }): Promise<{
    zaloUid: string
    proxyUrl: string | null
    webhookSecret: string | null
    credentials: ZaloPersonalRawCredentials
  } | null> => {
    const row = await db.query.integrationZaloPersonalModel.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    if (!row) {
      return null
    }
    const auth = row.auth as {
      encryptedCredentials?: EncryptedData
      webhookSecret?: string
    }
    if (!auth.encryptedCredentials) {
      return null
    }
    const credentials = await encryptUtils.decryptObject(
      auth.encryptedCredentials,
      zaloPersonalRawCredentialsSchema,
      row.zaloUid,
    )
    return {
      zaloUid: row.zaloUid,
      proxyUrl: row.proxyUrl,
      webhookSecret: auth.webhookSecret ?? null,
      credentials,
    }
  },

  /**
   * Adds every friend of the account as a contact on its inbox, including
   * friends the account never chatted with. Idempotent: friends that are
   * already contacts are left as they are. The sourceId is the friend's
   * Zalo user id — the same one an incoming 1-1 message resolves to — so a
   * later message lands on the imported contact.
   */
  importFriends: async (input: {
    id: string
    workspaceId: string
    friends: ZaloPersonalFriend[]
  }): Promise<{ total: number; imported: number } | null> => {
    const row = await db.query.integrationZaloPersonalModel.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
      columns: { inboxId: true },
    })
    if (!row) {
      return null
    }
    const inbox = await db.query.inboxModel.findFirst({
      where: { id: row.inboxId, workspaceId: input.workspaceId },
    })
    if (!inbox) {
      return null
    }

    let imported = 0
    for (let i = 0; i < input.friends.length; i += FRIEND_IMPORT_BATCH_SIZE) {
      const batch = input.friends.slice(i, i + FRIEND_IMPORT_BATCH_SIZE)
      const result = await bulkImportChannelContacts({
        inbox,
        workspaceId: input.workspaceId,
        contacts: batch.map((friend) => ({
          sourceId: friend.userId,
          firstName: friend.displayName,
          ...(friend.avatar ? { avatar: friend.avatar } : {}),
          ...(friend.phoneNumber ? { phoneNumber: friend.phoneNumber } : {}),
        })),
      })
      imported += result.importedContacts
      if (result.failureReason) {
        break
      }
    }
    return { total: input.friends.length, imported }
  },

  updateSettings: async (input: {
    id: string
    workspaceId: string
    name?: string
    proxyUrl?: string | null
    groupReplyConfig?: ZaloPersonalGroupReplyConfig
  }): Promise<SanitizedZaloPersonalIntegration | null> => {
    const existing = await db.query.integrationZaloPersonalModel.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    if (!existing) {
      return null
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(integrationZaloPersonalModel)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.proxyUrl === undefined ? {} : { proxyUrl: input.proxyUrl }),
          ...(input.groupReplyConfig === undefined
            ? {}
            : { groupReplyConfig: input.groupReplyConfig }),
        })
        .where(eq(integrationZaloPersonalModel.id, existing.id))
        .returning()

      if (input.name !== undefined) {
        await inboxService.updateName({
          id: existing.inboxId,
          name: input.name,
          tx,
        })
      }

      return row
    })

    return updated ? toSanitized(updated) : null
  },

  delete: async (input: {
    id: string
    workspaceId: string
  }): Promise<{ zaloUid: string } | null> => {
    const existing = await db.query.integrationZaloPersonalModel.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    if (!existing) {
      return null
    }

    const workspace = await db.query.workspaceModel.findFirst({
      where: { id: input.workspaceId },
      columns: { ownerId: true },
    })

    await db.transaction(async (tx) => {
      await tx
        .delete(integrationZaloPersonalModel)
        .where(eq(integrationZaloPersonalModel.id, existing.id))
      await inboxService.disconnect({
        inboxId: existing.inboxId,
        ownerId: workspace?.ownerId ?? input.workspaceId,
        workspaceId: input.workspaceId,
        reason: "manual",
        tx,
      })
    })

    return { zaloUid: existing.zaloUid }
  },
}

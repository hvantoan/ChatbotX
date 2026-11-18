import { db, eq } from "@chatbotx.io/database/client"
import { channelTypes } from "@chatbotx.io/database/partials"
import {
  integrationZaloPersonalModel,
  type ZaloPersonalGroupReplyConfig,
} from "@chatbotx.io/database/schema"
import { type EncryptedData, encryptUtils } from "@chatbotx.io/encryption"
import { createId } from "@chatbotx.io/utils"
import { z } from "zod"
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
    credentials: ZaloPersonalRawCredentials
  } | null> => {
    const row = await db.query.integrationZaloPersonalModel.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    if (!row) {
      return null
    }
    const auth = row.auth as { encryptedCredentials?: EncryptedData }
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
      credentials,
    }
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

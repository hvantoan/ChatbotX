import { db, eq } from "@chatbotx.io/database/client"
import { channelTypes } from "@chatbotx.io/database/partials"
import {
  inboxModel,
  integrationZaloPersonalModel,
  type ZaloPersonalGroupReplyConfig,
} from "@chatbotx.io/database/schema"
import { type EncryptedData, encryptUtils } from "@chatbotx.io/encryption"
import { createId } from "@chatbotx.io/utils"
import { z } from "zod"
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

    const row = await db.transaction(async (tx) => {
      const inboxId = createId()
      await tx.insert(inboxModel).values({
        id: inboxId,
        workspaceId: input.workspaceId,
        channel: channelTypes.enum.zalo_personal,
        sourceId: input.zaloUid,
        name: input.name,
      })

      const integrationId = createId()
      const [inserted] = await tx
        .insert(integrationZaloPersonalModel)
        .values({
          id: integrationId,
          workspaceId: input.workspaceId,
          inboxId,
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
        await tx
          .update(inboxModel)
          .set({ name: input.name })
          .where(eq(inboxModel.id, existing.inboxId))
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

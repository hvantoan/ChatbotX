import { type DatabaseClient, db, eq } from "@inboxos.io/database/client"
import { integrationShopifyModel } from "@inboxos.io/database/schema"
import { createId } from "@inboxos.io/utils"

type IntegrationShopifyInsert = typeof integrationShopifyModel.$inferInsert

export type IntegrationShopifyValues = Omit<
  IntegrationShopifyInsert,
  "id" | "createdAt" | "updatedAt" | "workspaceId"
>

export const shopifyRepository = {
  async findIntegration(workspaceId: string, tx: DatabaseClient = db) {
    return await tx.query.integrationShopifyModel.findFirst({
      where: { workspaceId },
    })
  },

  /** One connection per workspace: connecting again replaces it. */
  async upsertIntegration(
    input: { workspaceId: string; values: IntegrationShopifyValues },
    tx: DatabaseClient = db,
  ) {
    const [row] = await tx
      .insert(integrationShopifyModel)
      .values({
        id: createId(),
        workspaceId: input.workspaceId,
        ...input.values,
      })
      .onConflictDoUpdate({
        target: integrationShopifyModel.workspaceId,
        set: { ...input.values, updatedAt: new Date() },
      })
      .returning()
    return row
  },

  async updateIntegration(
    input: {
      workspaceId: string
      values: Partial<IntegrationShopifyValues>
    },
    tx: DatabaseClient = db,
  ) {
    const [row] = await tx
      .update(integrationShopifyModel)
      .set({ ...input.values, updatedAt: new Date() })
      .where(eq(integrationShopifyModel.workspaceId, input.workspaceId))
      .returning()
    return row
  },

  async deleteIntegration(workspaceId: string, tx: DatabaseClient = db) {
    await tx
      .delete(integrationShopifyModel)
      .where(eq(integrationShopifyModel.workspaceId, workspaceId))
  },
}

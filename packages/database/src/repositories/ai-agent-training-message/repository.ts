import { createId } from "@inboxos.io/utils"
import { and, type DatabaseClient, db, eq, isNull } from "../../client"
import type {
  AIAgentTrainingMessageRole,
  AIAgentTrainingProposal,
} from "../../partials"
import { aiAgentTrainingMessageModel } from "../../schema"
import type { AIAgentTrainingMessageModel } from "../../types"
import { newestFirstKeyset } from "../pipeline/item-cursor"

export type AppendAIAgentTrainingMessageInput = {
  role: AIAgentTrainingMessageRole
  content: string
  proposal?: AIAgentTrainingProposal | null
  appliedVersion?: number | null
  createdById?: string | null
}

export type AIAgentTrainingMessagePage = {
  items: AIAgentTrainingMessageModel[]
  nextCursor: string | null
}

export const aiAgentTrainingMessageRepository = {
  async appendMany(
    input: {
      workspaceId: string
      aiAgentId: string
      messages: AppendAIAgentTrainingMessageInput[]
    },
    tx: DatabaseClient = db,
  ): Promise<AIAgentTrainingMessageModel[]> {
    if (input.messages.length === 0) {
      return []
    }
    const rows = input.messages.map((message) => ({
      id: createId(),
      workspaceId: input.workspaceId,
      aiAgentId: input.aiAgentId,
      role: message.role,
      content: message.content,
      proposal: message.proposal ?? null,
      appliedVersion: message.appliedVersion ?? null,
      createdById: message.createdById ?? null,
    }))
    const inserted = await tx
      .insert(aiAgentTrainingMessageModel)
      .values(rows)
      .returning()
    const byId = new Map(inserted.map((row) => [row.id, row]))
    return rows.flatMap((row) => {
      const created = byId.get(row.id)
      return created ? [created] : []
    })
  },

  async list(
    input: {
      workspaceId: string
      aiAgentId: string
      cursor?: string | null
      limit?: number
    },
    tx: DatabaseClient = db,
  ): Promise<AIAgentTrainingMessagePage> {
    const keyset = newestFirstKeyset(
      {
        timestamp: aiAgentTrainingMessageModel.createdAt,
        id: aiAgentTrainingMessageModel.id,
      },
      {
        limit: input.limit ?? 20,
        cursor: input.cursor ?? undefined,
      },
    )
    const rows = await tx
      .select({
        message: aiAgentTrainingMessageModel,
        timestampText: keyset.timestampText,
      })
      .from(aiAgentTrainingMessageModel)
      .where(
        and(
          eq(aiAgentTrainingMessageModel.workspaceId, input.workspaceId),
          eq(aiAgentTrainingMessageModel.aiAgentId, input.aiAgentId),
          keyset.after,
        ),
      )
      .orderBy(...keyset.orderBy)
      .limit(keyset.fetchLimit)

    const page = keyset.page(rows, (row) => ({
      sortValue: row.timestampText,
      id: row.message.id,
    }))
    return {
      items: page.rows.map((row) => row.message),
      nextCursor: page.nextCursor,
    }
  },

  async markApplied(
    input: {
      workspaceId: string
      aiAgentId?: string
      messageId: string
      version: number
    },
    tx: DatabaseClient = db,
  ): Promise<AIAgentTrainingMessageModel | null> {
    const [row] = await tx
      .update(aiAgentTrainingMessageModel)
      .set({
        appliedVersion: input.version,
      })
      .where(
        and(
          eq(aiAgentTrainingMessageModel.id, input.messageId),
          eq(aiAgentTrainingMessageModel.workspaceId, input.workspaceId),
          eq(aiAgentTrainingMessageModel.role, "assistant"),
          isNull(aiAgentTrainingMessageModel.appliedVersion),
          input.aiAgentId
            ? eq(aiAgentTrainingMessageModel.aiAgentId, input.aiAgentId)
            : undefined,
        ),
      )
      .returning()
    return row ?? null
  },

  async clear(
    input: { workspaceId: string; aiAgentId: string },
    tx: DatabaseClient = db,
  ): Promise<number> {
    const rows = await tx
      .delete(aiAgentTrainingMessageModel)
      .where(
        and(
          eq(aiAgentTrainingMessageModel.workspaceId, input.workspaceId),
          eq(aiAgentTrainingMessageModel.aiAgentId, input.aiAgentId),
        ),
      )
      .returning({ id: aiAgentTrainingMessageModel.id })
    return rows.length
  },
}

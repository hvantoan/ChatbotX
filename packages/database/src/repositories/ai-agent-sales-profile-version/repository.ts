import { createId } from "@chatbotx.io/utils"
import { and, type DatabaseClient, db, desc, eq, lt } from "../../client"
import type {
  AIAgentSalesProfile,
  AIAgentSalesProfileVersionSource,
} from "../../partials"
import { aiAgentModel, aiAgentSalesProfileVersionModel } from "../../schema"
import type { AIAgentModel, AIAgentSalesProfileVersionModel } from "../../types"
import { clampPageLimit } from "../pipeline/item-cursor"

export type CreateAIAgentSalesProfileVersionInput = {
  workspaceId: string
  aiAgentId: string
  version: number
  profile: AIAgentSalesProfile
  source: AIAgentSalesProfileVersionSource
  instruction?: string | null
  createdById?: string | null
}

export type AIAgentSalesProfileVersionPage = {
  items: AIAgentSalesProfileVersionModel[]
  nextCursor: string | null
}

const POSITIVE_INT_PATTERN = /^[1-9]\d*$/

function parseVersionCursor(raw: string): number {
  if (!POSITIVE_INT_PATTERN.test(raw)) {
    throw new Error("Invalid version cursor")
  }
  const version = Number(raw)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Invalid version cursor")
  }
  return version
}

export const aiAgentSalesProfileVersionRepository = {
  async lockAgent(
    input: { workspaceId: string; aiAgentId: string },
    tx: DatabaseClient,
  ): Promise<AIAgentModel | null> {
    const [row] = await tx
      .select()
      .from(aiAgentModel)
      .where(
        and(
          eq(aiAgentModel.id, input.aiAgentId),
          eq(aiAgentModel.workspaceId, input.workspaceId),
        ),
      )
      .limit(1)
      .for("update")
    return row ?? null
  },

  async create(
    input: CreateAIAgentSalesProfileVersionInput,
    tx: DatabaseClient = db,
  ): Promise<AIAgentSalesProfileVersionModel> {
    const [row] = await tx
      .insert(aiAgentSalesProfileVersionModel)
      .values({
        id: createId(),
        workspaceId: input.workspaceId,
        aiAgentId: input.aiAgentId,
        version: input.version,
        profile: input.profile,
        source: input.source,
        instruction: input.instruction ?? null,
        createdById: input.createdById ?? null,
      })
      .returning()
    if (!row) {
      throw new Error("Failed to insert AI agent sales profile version")
    }
    return row
  },

  async updateAgentSalesProfile(
    input: {
      workspaceId: string
      aiAgentId: string
      profile: AIAgentSalesProfile
      version: number
    },
    tx: DatabaseClient,
  ): Promise<AIAgentModel | null> {
    const [row] = await tx
      .update(aiAgentModel)
      .set({
        salesProfile: input.profile,
        salesProfileVersion: input.version,
      })
      .where(
        and(
          eq(aiAgentModel.id, input.aiAgentId),
          eq(aiAgentModel.workspaceId, input.workspaceId),
        ),
      )
      .returning()
    return row ?? null
  },

  async findByVersion(
    input: { workspaceId: string; aiAgentId: string; version: number },
    tx: DatabaseClient = db,
  ): Promise<AIAgentSalesProfileVersionModel | null> {
    const row = await tx.query.aiAgentSalesProfileVersionModel.findFirst({
      where: {
        workspaceId: input.workspaceId,
        aiAgentId: input.aiAgentId,
        version: input.version,
      },
    })
    return row ?? null
  },

  async listVersions(
    input: {
      workspaceId: string
      aiAgentId: string
      cursor?: string | null
      limit?: number
    },
    tx: DatabaseClient = db,
  ): Promise<AIAgentSalesProfileVersionPage> {
    const limit = clampPageLimit(input.limit ?? 20)
    const cursorVersion = input.cursor ? parseVersionCursor(input.cursor) : null
    const rows = await tx
      .select()
      .from(aiAgentSalesProfileVersionModel)
      .where(
        and(
          eq(aiAgentSalesProfileVersionModel.workspaceId, input.workspaceId),
          eq(aiAgentSalesProfileVersionModel.aiAgentId, input.aiAgentId),
          cursorVersion === null
            ? undefined
            : lt(aiAgentSalesProfileVersionModel.version, cursorVersion),
        ),
      )
      .orderBy(desc(aiAgentSalesProfileVersionModel.version))
      .limit(limit + 1)

    const items = rows.slice(0, limit)
    const last = items.at(-1)
    return {
      items,
      nextCursor: rows.length > limit && last ? String(last.version) : null,
    }
  },
}

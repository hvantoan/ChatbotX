import { type DatabaseClient, db } from "@chatbotx.io/database/client"
import {
  type AIAgentSalesProfile,
  type AIAgentSalesProfileVersionSource,
  type AIAgentTrainingMessageRole,
  type AIAgentTrainingProposal,
  aiAgentSalesProfileSchema,
  aiAgentTrainingMessageRoles,
  aiAgentTrainingProposalSchema,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@chatbotx.io/database/partials"
import {
  type AIAgentSalesProfileVersionPage,
  type AIAgentTrainingMessagePage,
  aiAgentSalesProfileVersionRepository,
  aiAgentTrainingMessageRepository,
  InvalidPipelineCursorError,
  productRepository,
} from "@chatbotx.io/database/repositories"
import type {
  AIAgentSalesProfileVersionModel,
  AIAgentTrainingMessageModel,
} from "@chatbotx.io/database/types"
import { z } from "zod"
import { isSameJsonValue } from "../audit/diff"
import { BaseService } from "../base.service"
import {
  conflictException,
  notFoundException,
  validationException,
} from "../errors"
import { assertResourceEditable } from "../template/installed-resource.service"
import { withTemplateLockedTransaction } from "../template/template-resource-locks"
import { referencedParentsOf } from "../template/uninstall-references"
import { aiAgentService } from "./service"

export const DEFAULT_AI_AGENT_SALES_PROFILE: AIAgentSalesProfile = {
  enabled: false,
  tone: "",
  role: "",
  objective: "",
  targetProducts: [],
  forbiddenTopics: [],
  offTopicLimit: 3,
  handoverOnHumanRequest: true,
  handoffMessage: DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
  handoffTriggers: "",
}

export const aiAgentTrainingMessageInputSchema = z.object({
  role: aiAgentTrainingMessageRoles,
  content: z.string().trim().min(1).max(4000),
  proposal: aiAgentTrainingProposalSchema.nullable().optional(),
  appliedVersion: z.number().int().positive().nullable().optional(),
  createdById: z.string().nullable().optional(),
})

export type AIAgentSalesProfileState = {
  profile: AIAgentSalesProfile | null
  version: number
}

export type UpdateAIAgentSalesProfileResult = {
  profile: AIAgentSalesProfile
  version: number
  versionRecord: AIAgentSalesProfileVersionModel
}

class AiAgentSalesProfileService extends BaseService {
  private async requireAgent(
    input: { workspaceId: string; aiAgentId: string },
    tx: DatabaseClient = db,
  ) {
    const agent = await aiAgentService.findBy({
      tx,
      where: {
        id: input.aiAgentId,
        workspaceId: input.workspaceId,
      },
    })
    if (!agent) {
      throw notFoundException("AI agent not found")
    }
    return agent
  }

  private async validateTargetProducts(
    workspaceId: string,
    profile: AIAgentSalesProfile,
    tx: DatabaseClient,
  ): Promise<void> {
    const productIds = [
      ...new Set(profile.targetProducts.map((item) => item.productId)),
    ]
    if (productIds.length !== profile.targetProducts.length) {
      throw validationException(
        "targetProducts",
        "Duplicate target products are not allowed.",
      )
    }
    if (productIds.length === 0) {
      return
    }
    const products = await productRepository.findByIds(
      { workspaceId, productIds },
      tx,
    )
    const byId = new Map(products.map((product) => [product.id, product]))
    for (const productId of productIds) {
      const product = byId.get(productId)
      if (!product) {
        throw validationException(
          "targetProducts",
          `Product ${productId} does not belong to this workspace.`,
        )
      }
      if (product.status !== "active") {
        throw validationException(
          "targetProducts",
          `Product ${productId} is not active.`,
        )
      }
    }
  }

  async get(input: {
    workspaceId: string
    aiAgentId: string
    tx?: DatabaseClient
  }): Promise<AIAgentSalesProfileState> {
    const agent = await this.requireAgent(input, input.tx)
    const parsed = agent.salesProfile
      ? aiAgentSalesProfileSchema.safeParse(agent.salesProfile)
      : null
    return {
      profile: parsed?.success ? parsed.data : null,
      version: agent.salesProfileVersion ?? 0,
    }
  }

  async update(input: {
    workspaceId: string
    aiAgentId: string
    profile: AIAgentSalesProfile
    source: AIAgentSalesProfileVersionSource
    instruction?: string | null
    actorId?: string | null
    messageId?: string | null
    tx?: DatabaseClient
  }): Promise<UpdateAIAgentSalesProfileResult> {
    const parsed = aiAgentSalesProfileSchema.safeParse(input.profile)
    if (!parsed.success) {
      throw validationException(
        "profile",
        parsed.error.issues[0]?.message ?? "Invalid sales profile.",
      )
    }
    const profile = parsed.data

    const run = async (
      tx: DatabaseClient,
    ): Promise<UpdateAIAgentSalesProfileResult> => {
      const locked = await aiAgentSalesProfileVersionRepository.lockAgent(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
        },
        tx,
      )
      if (!locked) {
        throw notFoundException("AI agent not found")
      }

      const currentParsed = locked.salesProfile
        ? aiAgentSalesProfileSchema.safeParse(locked.salesProfile)
        : null
      const currentProfile = currentParsed?.success ? currentParsed.data : null

      // Apply a stored proposal's diff onto the live profile instead of
      // writing its stale full snapshot: edits made after the proposal was
      // generated are kept, and an edit to a field the proposal also touches
      // is a conflict.
      let profileToWrite = profile
      if (input.messageId) {
        const message = await tx.query.aiAgentTrainingMessageModel.findFirst({
          where: {
            id: input.messageId,
            workspaceId: input.workspaceId,
            aiAgentId: input.aiAgentId,
          },
        })
        const storedProposal = message?.proposal
          ? aiAgentTrainingProposalSchema.safeParse(message.proposal)
          : null
        if (storedProposal?.success) {
          const base = currentProfile ?? DEFAULT_AI_AGENT_SALES_PROFILE
          const merged: Record<string, unknown> = { ...base }
          const staleFields: string[] = []
          for (const entry of storedProposal.data.diff) {
            if (
              !isSameJsonValue(
                base[entry.field as keyof AIAgentSalesProfile],
                entry.before,
              )
            ) {
              staleFields.push(entry.field)
            }
            merged[entry.field] = entry.after
          }
          if (staleFields.length > 0) {
            throw conflictException(
              `The proposal was generated from an older profile; ${staleFields.join(", ")} changed since. Generate a new proposal and apply it again.`,
              "salesProfileProposalStale",
            )
          }
          const mergedParsed = aiAgentSalesProfileSchema.safeParse(merged)
          if (!mergedParsed.success) {
            throw validationException(
              "profile",
              mergedParsed.error.issues[0]?.message ?? "Invalid sales profile.",
            )
          }
          profileToWrite = mergedParsed.data
        }
      }

      // A view-only template copy keeps salesProfile locked: any write to it
      // (manual edit, proposal apply, revert) must go through the same guard.
      const profileChanged = !isSameJsonValue(
        currentProfile ?? null,
        profileToWrite,
      )
      if (profileChanged) {
        await assertResourceEditable({
          workspaceId: input.workspaceId,
          resourceKind: "aiAgent",
          resourceIds: [input.aiAgentId],
          changedKeys: ["salesProfile"],
          referencedParents: referencedParentsOf(profileToWrite),
          tx,
        })
      }

      await this.validateTargetProducts(input.workspaceId, profileToWrite, tx)

      const nextVersion = (locked.salesProfileVersion ?? 0) + 1
      const versionRecord = await aiAgentSalesProfileVersionRepository.create(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
          version: nextVersion,
          profile: profileToWrite,
          source: input.source,
          instruction: input.instruction ?? null,
          createdById: input.actorId ?? null,
        },
        tx,
      )

      await aiAgentSalesProfileVersionRepository.updateAgentSalesProfile(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
          profile: profileToWrite,
          version: nextVersion,
        },
        tx,
      )

      if (input.messageId) {
        await aiAgentTrainingMessageRepository.markApplied(
          {
            workspaceId: input.workspaceId,
            aiAgentId: input.aiAgentId,
            messageId: input.messageId,
            version: nextVersion,
          },
          tx,
        )
      }

      return {
        profile: profileToWrite,
        version: nextVersion,
        versionRecord,
      }
    }

    const result = await (input.tx
      ? run(input.tx)
      : withTemplateLockedTransaction(run, {
          workspaceId: input.workspaceId,
          initialKeys: [
            { kind: "aiAgent", resourceId: input.aiAgentId },
            ...referencedParentsOf(profile),
          ],
        }))
    await aiAgentService.invalidateWorkspaceCache(input.workspaceId)
    return result
  }

  async listVersions(input: {
    workspaceId: string
    aiAgentId: string
    cursor?: string | null
    limit?: number
    tx?: DatabaseClient
  }): Promise<AIAgentSalesProfileVersionPage> {
    await this.requireAgent(input, input.tx)
    try {
      return await aiAgentSalesProfileVersionRepository.listVersions(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
          cursor: input.cursor,
          limit: input.limit,
        },
        input.tx,
      )
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Invalid version cursor"
      ) {
        throw validationException("cursor", "Invalid version cursor.")
      }
      throw error
    }
  }

  async revert(input: {
    workspaceId: string
    aiAgentId: string
    version: number
    actorId?: string | null
    tx?: DatabaseClient
  }): Promise<UpdateAIAgentSalesProfileResult> {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw validationException("version", "Invalid version number.")
    }

    const run = async (
      tx: DatabaseClient,
    ): Promise<UpdateAIAgentSalesProfileResult> => {
      const locked = await aiAgentSalesProfileVersionRepository.lockAgent(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
        },
        tx,
      )
      if (!locked) {
        throw notFoundException("AI agent not found")
      }

      const target = await aiAgentSalesProfileVersionRepository.findByVersion(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
          version: input.version,
        },
        tx,
      )
      if (!target) {
        throw notFoundException("Sales profile version not found")
      }

      const parsed = aiAgentSalesProfileSchema.parse(target.profile)

      const currentParsed = locked.salesProfile
        ? aiAgentSalesProfileSchema.safeParse(locked.salesProfile)
        : null
      const profileChanged = !isSameJsonValue(
        currentParsed?.success ? currentParsed.data : null,
        parsed,
      )
      if (profileChanged) {
        await assertResourceEditable({
          workspaceId: input.workspaceId,
          resourceKind: "aiAgent",
          resourceIds: [input.aiAgentId],
          changedKeys: ["salesProfile"],
          referencedParents: referencedParentsOf(parsed),
          tx,
        })
      }

      await this.validateTargetProducts(input.workspaceId, parsed, tx)

      const nextVersion = (locked.salesProfileVersion ?? 0) + 1
      const versionRecord = await aiAgentSalesProfileVersionRepository.create(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
          version: nextVersion,
          profile: parsed,
          source: "revert",
          instruction: `Revert to v${target.version}`,
          createdById: input.actorId ?? null,
        },
        tx,
      )

      await aiAgentSalesProfileVersionRepository.updateAgentSalesProfile(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
          profile: parsed,
          version: nextVersion,
        },
        tx,
      )

      return {
        profile: parsed,
        version: nextVersion,
        versionRecord,
      }
    }

    const result = await (input.tx
      ? run(input.tx)
      : withTemplateLockedTransaction(run, {
          workspaceId: input.workspaceId,
          initialKeys: [{ kind: "aiAgent", resourceId: input.aiAgentId }],
        }))
    await aiAgentService.invalidateWorkspaceCache(input.workspaceId)
    return result
  }

  async appendMessages(input: {
    workspaceId: string
    aiAgentId: string
    messages: Array<{
      role: AIAgentTrainingMessageRole
      content: string
      proposal?: AIAgentTrainingProposal | null
      appliedVersion?: number | null
      createdById?: string | null
    }>
    tx?: DatabaseClient
  }): Promise<AIAgentTrainingMessageModel[]> {
    const parsedMessages = z
      .array(aiAgentTrainingMessageInputSchema)
      .min(1)
      .max(20)
      .safeParse(input.messages)
    if (!parsedMessages.success) {
      throw validationException(
        "messages",
        parsedMessages.error.issues[0]?.message ?? "Invalid training messages.",
      )
    }

    const run = async (tx: DatabaseClient) => {
      await this.requireAgent(input, tx)
      return await aiAgentTrainingMessageRepository.appendMany(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
          messages: parsedMessages.data,
        },
        tx,
      )
    }

    return await (input.tx ? run(input.tx) : db.transaction(run))
  }

  async listMessages(input: {
    workspaceId: string
    aiAgentId: string
    cursor?: string | null
    limit?: number
    tx?: DatabaseClient
  }): Promise<AIAgentTrainingMessagePage> {
    await this.requireAgent(input, input.tx)
    try {
      return await aiAgentTrainingMessageRepository.list(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
          cursor: input.cursor,
          limit: input.limit,
        },
        input.tx,
      )
    } catch (error) {
      if (error instanceof InvalidPipelineCursorError) {
        throw validationException("cursor", "Invalid training message cursor.")
      }
      throw error
    }
  }

  async markApplied(input: {
    workspaceId: string
    aiAgentId?: string
    messageId: string
    version: number
    tx?: DatabaseClient
  }): Promise<AIAgentTrainingMessageModel> {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw validationException("version", "Invalid version number.")
    }
    const updated = await aiAgentTrainingMessageRepository.markApplied(
      {
        workspaceId: input.workspaceId,
        aiAgentId: input.aiAgentId,
        messageId: input.messageId,
        version: input.version,
      },
      input.tx,
    )
    if (!updated) {
      throw notFoundException("Training message not found")
    }
    return updated
  }

  async clear(input: {
    workspaceId: string
    aiAgentId: string
    tx?: DatabaseClient
  }): Promise<{ deletedCount: number }> {
    await this.requireAgent(input, input.tx)
    const deletedCount = await aiAgentTrainingMessageRepository.clear(
      {
        workspaceId: input.workspaceId,
        aiAgentId: input.aiAgentId,
      },
      input.tx,
    )
    return { deletedCount }
  }
}

export const aiAgentSalesProfileService = new AiAgentSalesProfileService()

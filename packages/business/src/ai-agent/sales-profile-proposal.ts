import { db } from "@chatbotx.io/database/client"
import {
  type AIAgentProviderModels,
  type AIAgentSalesProfile,
  type AIAgentSalesProfileDiffEntry,
  type AIAgentTrainingProposal,
  aiAgentProviderModels,
  aiAgentSalesProfileSchema,
} from "@chatbotx.io/database/partials"
import {
  aiAgentTrainingMessageRepository,
  productRepository,
} from "@chatbotx.io/database/repositories"
import type { AIAgentTrainingMessageModel } from "@chatbotx.io/database/types"
import { distributedStore } from "@chatbotx.io/redis"
import { isSameJsonValue } from "../audit/diff"
import { BaseService } from "../base.service"
import { resolveStoreSource } from "../ecommerce-settings/store-source"
import {
  ChatbotXException,
  notFoundException,
  validationException,
} from "../errors"
import { logger } from "../logger"
import { quotaEnforcementService } from "../quota-enforcement/service"
import { workspaceService } from "../workspace/service"
import { workspaceBotMessageUsageService } from "../workspace-bot-message-usage/service"
import { workspaceUsageService } from "../workspace-usage/service"
import {
  aiAgentSalesProfileService,
  DEFAULT_AI_AGENT_SALES_PROFILE,
} from "./sales-profile.service"
import { aiAgentService } from "./service"

const SALES_PROFILE_PROPOSE_WINDOW_SECONDS = 10
const SALES_PROFILE_PROPOSE_LIMIT = 5
const MAX_ACTIVE_PRODUCTS_FOR_PROPOSAL = 50
const MAX_TRAINING_HISTORY_MESSAGES = 20

const PROFILE_DIFF_FIELDS: ReadonlyArray<keyof AIAgentSalesProfile> = [
  "enabled",
  "tone",
  "role",
  "objective",
  "targetProducts",
  "forbiddenTopics",
  "offTopicLimit",
  "handoverOnHumanRequest",
  "handoffMessage",
  "handoffTriggers",
]

export type SalesProfileProposalModelInput = {
  workspaceId: string
  models: AIAgentProviderModels
  currentProfile: AIAgentSalesProfile
  products: Array<{
    id: string
    name: string
    price: number
    discount?: number | null
    currency: string
  }>
  conversation: Array<{ role: "admin" | "assistant"; content: string }>
  instruction: string
}

export type SalesProfileProposalModelOutput = Partial<AIAgentSalesProfile> & {
  clarifyingQuestion?: string
  unmatchedProducts?: string[]
}

export type SalesProfileProposalModelRunner = (
  input: SalesProfileProposalModelInput,
) => Promise<SalesProfileProposalModelOutput>

export type ProposeSalesProfileResult = AIAgentTrainingProposal & {
  adminMessage: AIAgentTrainingMessageModel
  assistantMessage: AIAgentTrainingMessageModel
}

export function buildSalesProfileDiff(
  before: AIAgentSalesProfile,
  after: AIAgentSalesProfile,
): AIAgentSalesProfileDiffEntry[] {
  const diff: AIAgentSalesProfileDiffEntry[] = []
  for (const field of PROFILE_DIFF_FIELDS) {
    if (!isSameJsonValue(before[field], after[field])) {
      diff.push({
        field,
        before: before[field],
        after: after[field],
      })
    }
  }
  return diff
}

const MAX_ASSISTANT_SUMMARY_LENGTH = 4000

function buildAssistantSummaryText(proposal: AIAgentTrainingProposal): string {
  const parts: string[] = []
  if (proposal.unmatchedProducts?.length) {
    parts.push(
      `Không tìm thấy sản phẩm: ${proposal.unmatchedProducts.join(", ")}.`,
    )
  }
  if (proposal.clarifyingQuestion) {
    parts.push(proposal.clarifyingQuestion)
  }
  if (proposal.diff.length > 0) {
    const fields = proposal.diff.map((d) => d.field).join(", ")
    parts.push(`Đã đề xuất cập nhật: ${fields}.`)
  } else if (parts.length === 0) {
    parts.push("Không có thay đổi nào được đề xuất.")
  }
  const text = parts.join(" ")
  // Training messages are capped at 4000 characters; a long unmatched list
  // plus a long clarifying question must not fail the save after the
  // provider call was already paid for.
  return text.length > MAX_ASSISTANT_SUMMARY_LENGTH
    ? `${text.slice(0, MAX_ASSISTANT_SUMMARY_LENGTH - 1)}…`
    : text
}

class AiAgentSalesProfileProposalService extends BaseService {
  private modelRunner?: SalesProfileProposalModelRunner

  setModelRunner(runner: SalesProfileProposalModelRunner): void {
    this.modelRunner = runner
  }

  private async assertNotRateLimited(workspaceId: string): Promise<void> {
    const now = Date.now()
    const windowMs = SALES_PROFILE_PROPOSE_WINDOW_SECONDS * 1000
    const windowIndex = Math.floor(now / windowMs)
    const retryAfter = Math.ceil((windowMs - (now % windowMs)) / 1000)
    const key = `ai-sales-profile-propose-rate-limit:${workspaceId}:${windowIndex}`
    try {
      const count = await distributedStore.incrWithWindow(
        key,
        SALES_PROFILE_PROPOSE_WINDOW_SECONDS,
      )
      if (count > SALES_PROFILE_PROPOSE_LIMIT) {
        throw new ChatbotXException(
          `Too many requests. Retry after ${retryAfter}s.`,
          "tooManyRequests",
          429,
        )
      }
    } catch (error) {
      if (error instanceof ChatbotXException) {
        throw error
      }
      logger.warn(
        { err: error, workspaceId },
        "[sales-profile-proposal] Rate limit store failed, continuing",
      )
    }
  }

  private async checkAndRecordQuota(input: {
    workspaceId: string
    phase: "check" | "record"
  }): Promise<void> {
    try {
      const workspace = await workspaceService.find({
        where: { id: input.workspaceId },
      })
      if (!workspace) {
        return
      }
      if (input.phase === "check") {
        const [totalAtLimit, monthlyAtLimit] = await Promise.all([
          quotaEnforcementService.isAtLimit({
            userId: workspace.ownerId,
            metric: "botMessages",
          }),
          quotaEnforcementService.isAtLimit({
            userId: workspace.ownerId,
            metric: "monthlyBotMessages",
          }),
        ])
        if (totalAtLimit || monthlyAtLimit) {
          throw new ChatbotXException(
            "Bot message quota reached for this plan.",
            "quotaExceeded",
            403,
          )
        }
        return
      }
      await Promise.all([
        quotaEnforcementService.increment({
          userId: workspace.ownerId,
          metric: "botMessages",
        }),
        quotaEnforcementService.increment({
          userId: workspace.ownerId,
          metric: "monthlyBotMessages",
        }),
        workspaceBotMessageUsageService.increment({
          workspaceId: workspace.id,
          ownerId: workspace.ownerId,
          tenantId: workspace.tenantId,
          count: 1,
        }),
        workspaceUsageService.increment(workspace.id, "botMessages"),
      ])
    } catch (error) {
      if (error instanceof ChatbotXException) {
        throw error
      }
      logger.warn(
        { err: error, workspaceId: input.workspaceId, phase: input.phase },
        "[sales-profile-proposal] Quota accounting failed",
      )
    }
  }

  async propose(input: {
    workspaceId: string
    aiAgentId: string
    instruction: string
    actorId?: string | null
    generatePatch?: SalesProfileProposalModelRunner
  }): Promise<ProposeSalesProfileResult> {
    const trimmedInstruction = input.instruction.trim()
    if (!trimmedInstruction || trimmedInstruction.length > 4000) {
      throw validationException(
        "instruction",
        "Instruction must be between 1 and 4000 characters.",
      )
    }

    const agent = await aiAgentService.findBy({
      where: {
        id: input.aiAgentId,
        workspaceId: input.workspaceId,
      },
    })
    if (!agent) {
      throw notFoundException("AI agent not found")
    }

    await this.assertNotRateLimited(input.workspaceId)
    await this.checkAndRecordQuota({
      workspaceId: input.workspaceId,
      phase: "check",
    })

    const currentParsed = agent.salesProfile
      ? aiAgentSalesProfileSchema.safeParse(agent.salesProfile)
      : null
    const currentProfile: AIAgentSalesProfile = currentParsed?.success
      ? currentParsed.data
      : { ...DEFAULT_AI_AGENT_SALES_PROFILE }

    const source = await resolveStoreSource(input.workspaceId)
    const [allWorkspaceProducts, historyPage] = await Promise.all([
      productRepository.list(
        {
          workspaceId: input.workspaceId,
          source,
          status: "active",
          page: 1,
          perPage: MAX_ACTIVE_PRODUCTS_FOR_PROPOSAL,
          sort: [{ id: "rank", desc: false }],
        },
        db,
      ),
      aiAgentTrainingMessageRepository.list(
        {
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
          limit: MAX_TRAINING_HISTORY_MESSAGES,
        },
        db,
      ),
    ])

    const activeProducts = allWorkspaceProducts.data
      .filter((product) => product.status === "active")
      .slice(0, MAX_ACTIVE_PRODUCTS_FOR_PROPOSAL)

    const activeProductIdSet = new Set(activeProducts.map((p) => p.id))

    // History returned newest-first; reverse for chronological conversation context.
    const conversation = [...historyPage.items].reverse().map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))

    const runner = input.generatePatch ?? this.modelRunner
    if (!runner) {
      throw new ChatbotXException(
        "Sales profile proposal model runner is not configured.",
        "aiProviderNotConfigured",
        422,
      )
    }

    const models = aiAgentProviderModels.parse(agent.models)
    let rawPatch: SalesProfileProposalModelOutput
    try {
      rawPatch = await runner({
        workspaceId: input.workspaceId,
        models,
        currentProfile,
        products: activeProducts.map((p) => ({
          id: p.id,
          name: p.name,
          price: p.price,
          discount: p.discount,
          currency: p.currency,
        })),
        conversation,
        instruction: trimmedInstruction,
      })
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "SalesProfileProposalProviderNotConnectedError"
      ) {
        throw new ChatbotXException(
          error.message,
          "aiProviderNotConfigured",
          422,
        )
      }
      if (error instanceof ChatbotXException) {
        throw error
      }
      logger.error(
        {
          err: error,
          workspaceId: input.workspaceId,
          aiAgentId: input.aiAgentId,
        },
        "[sales-profile-proposal] AI provider failed to generate proposal",
      )
      const detail =
        error instanceof Error && error.message
          ? `: ${error.message.slice(0, 180)}`
          : "."
      throw new ChatbotXException(
        `AI provider failed to generate a sales profile proposal${detail}`,
        "aiProviderFailed",
        502,
      )
    }

    const mergedCandidate: AIAgentSalesProfile = {
      enabled: rawPatch.enabled ?? currentProfile.enabled,
      tone: rawPatch.tone ?? currentProfile.tone,
      role: rawPatch.role ?? currentProfile.role,
      objective: rawPatch.objective ?? currentProfile.objective,
      targetProducts: rawPatch.targetProducts ?? currentProfile.targetProducts,
      forbiddenTopics:
        rawPatch.forbiddenTopics ?? currentProfile.forbiddenTopics,
      offTopicLimit: rawPatch.offTopicLimit ?? currentProfile.offTopicLimit,
      handoverOnHumanRequest:
        rawPatch.handoverOnHumanRequest ??
        currentProfile.handoverOnHumanRequest,
      handoffMessage: rawPatch.handoffMessage ?? currentProfile.handoffMessage,
      handoffTriggers:
        rawPatch.handoffTriggers ?? currentProfile.handoffTriggers,
    }

    const validated = aiAgentSalesProfileSchema.safeParse(mergedCandidate)
    if (!validated.success) {
      throw validationException(
        "profile",
        validated.error.issues[0]?.message ?? "Invalid proposed sales profile.",
      )
    }

    const proposedProfile = validated.data

    // Re-check that every productId in proposedProfile belongs to the workspace and is active.
    const extraIds = proposedProfile.targetProducts
      .map((item) => item.productId)
      .filter((id) => !activeProductIdSet.has(id))
    if (extraIds.length > 0) {
      const checkedRows = await productRepository.findByIds(
        {
          workspaceId: input.workspaceId,
          productIds: [...new Set(extraIds)],
        },
        db,
      )
      const validExtraIds = new Set(
        checkedRows.filter((p) => p.status === "active").map((p) => p.id),
      )
      for (const productId of extraIds) {
        if (!validExtraIds.has(productId)) {
          throw validationException(
            "targetProducts",
            `Proposed product ${productId} does not belong to this workspace or is not active.`,
          )
        }
      }
    }

    const diff = buildSalesProfileDiff(currentProfile, proposedProfile)
    const proposal: AIAgentTrainingProposal = {
      proposedProfile,
      diff,
      ...(rawPatch.clarifyingQuestion
        ? { clarifyingQuestion: rawPatch.clarifyingQuestion }
        : {}),
      ...(rawPatch.unmatchedProducts?.length
        ? { unmatchedProducts: rawPatch.unmatchedProducts }
        : {}),
    }

    const assistantText = buildAssistantSummaryText(proposal)
    const appended = await aiAgentSalesProfileService.appendMessages({
      workspaceId: input.workspaceId,
      aiAgentId: input.aiAgentId,
      messages: [
        {
          role: "admin",
          content: trimmedInstruction,
          createdById: input.actorId ?? null,
        },
        {
          role: "assistant",
          content: assistantText,
          proposal,
          createdById: input.actorId ?? null,
        },
      ],
    })

    await this.checkAndRecordQuota({
      workspaceId: input.workspaceId,
      phase: "record",
    })

    const [adminMessage, assistantMessage] = appended
    if (!(adminMessage && assistantMessage)) {
      throw new Error("Failed to persist training messages")
    }

    return {
      ...proposal,
      adminMessage,
      assistantMessage,
    }
  }
}

export const aiAgentSalesProfileProposalService =
  new AiAgentSalesProfileProposalService()

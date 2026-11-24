import {
  aiAgentSalesProfileVersionSources,
  aiAgentTrainingMessageRoles,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@chatbotx.io/database/partials"
import type {
  AIAgentSalesProfileVersionModel,
  AIAgentTrainingMessageModel,
} from "@chatbotx.io/database/types"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"

export const aiAgentIdParamSchema = z.object({
  id: zodBigintAsString().describe("AI agent id. Get it from `aiAgents.list`."),
})

export const salesTargetProductPublicSchema = z.object({
  productId: zodBigintAsString().describe(
    "Active product id from the workspace catalog. Get it from `products.list`.",
  ),
  priority: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe(
      "Pitch priority from 1 (highest, pitched first when no product is named) to 10.",
    ),
  pitchNote: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe("Optional guidance for when or how to recommend this product."),
})

export const salesProfilePublicSchema = z.object({
  enabled: z
    .boolean()
    .default(false)
    .describe(
      "Whether the sales persona, runtime prompt compiler and reply guard are active for this agent.",
    ),
  tone: z
    .string()
    .trim()
    .max(1000)
    .default("")
    .describe(
      "Pronouns, politeness and speaking style used when replying to customers.",
    ),
  role: z
    .string()
    .trim()
    .max(500)
    .default("")
    .describe("Persona role the agent adopts during sales conversations."),
  objective: z
    .string()
    .trim()
    .max(1000)
    .default("")
    .describe("Primary sales goal the agent steers conversations toward."),
  targetProducts: z
    .array(salesTargetProductPublicSchema)
    .max(10)
    .default([])
    .describe(
      "Up to 10 active workspace products ordered by priority for pitching.",
    ),
  forbiddenTopics: z
    .array(z.string().trim().min(1).max(200))
    .max(20)
    .default([])
    .describe(
      "Up to 20 topics the agent must refuse or deflect back to the sales objective.",
    ),
  offTopicLimit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe(
      "Consecutive off-topic customer turns allowed before handing the conversation to a human agent.",
    ),
  handoverOnHumanRequest: z
    .boolean()
    .default(true)
    .describe(
      "Whether to immediately hand the conversation to a human agent when the customer asks for one.",
    ),
  handoffMessage: z
    .string()
    .trim()
    .max(500)
    .default(DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE)
    .describe(
      "Customer-facing waiting message sent right before transferring the conversation to a human advisor.",
    ),
  handoffTriggers: z
    .string()
    .trim()
    .max(1000)
    .default("")
    .describe(
      "Natural-language conditions under which the agent transfers the conversation to a human advisor (e.g. agrees to buy, asks to pay, requests an out-of-policy discount, or asks for 1:1 VIP consultation).",
    ),
})

export const salesProfileStateResponseSchema = z.object({
  profile: salesProfilePublicSchema
    .nullable()
    .describe(
      "Current sales profile, or null when no sales profile has been saved yet.",
    ),
  version: z
    .number()
    .int()
    .min(0)
    .describe(
      "Monotonic version counter of the active sales profile (0 when none has been saved).",
    ),
})

export const updateSalesProfileRequestSchema = z.object({
  profile: salesProfilePublicSchema.describe(
    "Complete sales profile to save as the next version.",
  ),
})

export const salesProfileVersionResourceSchema = z.object({
  id: zodBigintAsString().describe("Version entry id."),
  aiAgentId: zodBigintAsString().describe("AI agent id."),
  version: z
    .number()
    .int()
    .min(1)
    .describe("Sequential version number starting at 1."),
  profile: salesProfilePublicSchema.describe(
    "Sales profile snapshot stored at this version.",
  ),
  source: aiAgentSalesProfileVersionSources.describe(
    "How this version was created: `manual`, `proposal` or `revert`.",
  ),
  instruction: z
    .string()
    .nullable()
    .describe(
      "Natural-language instruction or revert label that produced this version.",
    ),
  createdById: zodBigintAsString()
    .nullable()
    .describe(
      "Workspace user id who created this version, or null for API tokens.",
    ),
  createdAt: z.coerce.date().describe("Timestamp when this version was saved."),
  updatedAt: z.coerce
    .date()
    .describe("Timestamp when this version was last updated."),
})

export function toPublicSalesProfileVersionResource(
  row: AIAgentSalesProfileVersionModel,
) {
  return {
    id: row.id,
    aiAgentId: row.aiAgentId,
    version: row.version,
    profile: row.profile,
    source: row.source,
    instruction: row.instruction,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const updateSalesProfileResponseSchema = z.object({
  profile: salesProfilePublicSchema.describe("Saved sales profile."),
  version: z
    .number()
    .int()
    .min(1)
    .describe("Newly created sales profile version number."),
  versionRecord: salesProfileVersionResourceSchema.describe(
    "Immutable version record written for this change.",
  ),
})

export const salesProfileDiffEntryPublicSchema = z.object({
  field: z.string().describe("Sales profile field name that changed."),
  before: z.unknown().describe("Previous field value before the proposal."),
  after: z.unknown().describe("Proposed field value."),
})

export const trainingProposalPublicSchema = z.object({
  proposedProfile: salesProfilePublicSchema.describe(
    "Merged candidate sales profile produced from the instruction.",
  ),
  diff: z
    .array(salesProfileDiffEntryPublicSchema)
    .describe(
      "Field-by-field diff between the active profile and the proposal.",
    ),
  clarifyingQuestion: z
    .string()
    .optional()
    .describe(
      "Follow-up question when a product name or instruction was ambiguous.",
    ),
  unmatchedProducts: z
    .array(z.string())
    .optional()
    .describe(
      "Product names mentioned in the instruction that did not match any active product.",
    ),
})

export const trainingMessageResourceSchema = z.object({
  id: zodBigintAsString().describe("Training message id."),
  aiAgentId: zodBigintAsString().describe("AI agent id."),
  role: aiAgentTrainingMessageRoles.describe(
    "Speaker role in the training chat: `admin` or `assistant`.",
  ),
  content: z.string().describe("Plain-text instruction or assistant summary."),
  proposal: trainingProposalPublicSchema
    .nullable()
    .describe("Structured proposal attached to an assistant message, or null."),
  appliedVersion: z
    .number()
    .int()
    .min(1)
    .nullable()
    .describe(
      "Version number created when this proposal was applied, or null if not applied.",
    ),
  createdById: zodBigintAsString()
    .nullable()
    .describe("User id who sent the instruction, or null for API tokens."),
  createdAt: z.coerce
    .date()
    .describe("Timestamp when the training message was recorded."),
  updatedAt: z.coerce
    .date()
    .describe("Timestamp when the training message was last updated."),
})

export function toPublicTrainingMessageResource(
  row: AIAgentTrainingMessageModel,
) {
  return {
    id: row.id,
    aiAgentId: row.aiAgentId,
    role: row.role,
    content: row.content,
    proposal: row.proposal,
    appliedVersion: row.appliedVersion,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const proposeSalesProfileRequestSchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .describe(
      "Natural-language instruction describing how the agent should sell, speak or prioritize products.",
    ),
})

export const proposeSalesProfileResponseSchema =
  trainingProposalPublicSchema.extend({
    adminMessage: trainingMessageResourceSchema.describe(
      "Persisted admin training message for this instruction.",
    ),
    assistantMessage: trainingMessageResourceSchema.describe(
      "Persisted assistant training message containing the proposal card.",
    ),
  })

export const applySalesProfileRequestSchema = z.object({
  profile: salesProfilePublicSchema.describe(
    "Proposed sales profile to validate and save as a new version.",
  ),
  instruction: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .describe(
      "Original natural-language instruction recorded on the version entry.",
    ),
  messageId: zodBigintAsString()
    .optional()
    .describe(
      "Assistant training message id to mark as applied with the new version number.",
    ),
})

export const listSalesProfileVersionsRequestSchema = z.object({
  cursor: z
    .string()
    .optional()
    .describe("`nextCursor` from the previous page; omit for the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Maximum number of versions to return per page (1-100, default 20).",
    ),
})

export const listSalesProfileVersionsResponseSchema = z.object({
  items: z
    .array(salesProfileVersionResourceSchema)
    .describe("Sales profile versions ordered from newest to oldest."),
  nextCursor: z
    .string()
    .nullable()
    .describe(
      "Opaque cursor for the next page, or null when no more versions exist.",
    ),
})

export const revertSalesProfileRequestSchema = z.object({
  version: z
    .number()
    .int()
    .min(1)
    .describe(
      "Historical version number to restore as a new `revert` version entry.",
    ),
})

export const listTrainingMessagesRequestSchema = z.object({
  cursor: z
    .string()
    .optional()
    .describe("`nextCursor` from the previous page; omit for the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Maximum number of training messages to return per page (1-100, default 30).",
    ),
})

export const listTrainingMessagesResponseSchema = z.object({
  items: z
    .array(trainingMessageResourceSchema)
    .describe("Training chat messages ordered from newest to oldest."),
  nextCursor: z
    .string()
    .nullable()
    .describe(
      "Opaque cursor for the next page, or null when no more messages exist.",
    ),
})

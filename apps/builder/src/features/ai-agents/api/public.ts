import { generateSalesProfileProposalPatch } from "@chatbotx.io/ai/sales-profile-proposer"
import {
  aiAgentSalesProfileProposalService,
  aiAgentSalesProfileService,
  aiAgentService,
} from "@chatbotx.io/business"
import { notFoundException } from "@chatbotx.io/business/errors"
import { zodBigintAsString } from "@chatbotx.io/utils"
import { z } from "zod"
import { mcpSpec } from "@/lib/orpc/mcp-annotations"
import {
  possibleErrorsOnCreatingResource,
  possibleErrorsOnDeletingResource,
  possibleErrorsOnFindingResource,
  possibleErrorsOnFindingWithCursor,
  possibleErrorsOnListingResource,
  possibleErrorsOnMutatingResource,
  possibleErrorsOnProposingSalesProfile,
} from "@/lib/orpc/orpc-error-helper"
import { publicListRequest } from "@/lib/public-api/list"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import {
  createPublicAIAgentRequest,
  updatePublicAIAgentRequest,
} from "../schema/public-action"
import { publicListAIAgentsResponse } from "../schema/query"
import {
  publicAIAgentResourceSchema,
  toPublicAIAgentResource,
} from "../schema/resource"
import {
  aiAgentIdParamSchema,
  applySalesProfileRequestSchema,
  listSalesProfileVersionsRequestSchema,
  listSalesProfileVersionsResponseSchema,
  listTrainingMessagesRequestSchema,
  listTrainingMessagesResponseSchema,
  proposeSalesProfileRequestSchema,
  proposeSalesProfileResponseSchema,
  revertSalesProfileRequestSchema,
  salesProfileStateResponseSchema,
  toPublicSalesProfileVersionResource,
  toPublicTrainingMessageResource,
  updateSalesProfileRequestSchema,
  updateSalesProfileResponseSchema,
} from "../schema/sales-profile"

const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("automation")

const salesProfilePublicRouter = {
  get: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/ai-agents/{id}/sales-profile",
      summary: "Get AI agent sales profile",
      description:
        "Returns the active sales profile and its version counter for one AI agent. `profile` is null and `version` is 0 until a profile is saved with `aiAgents.salesProfile.update` or `aiAgents.salesProfile.apply`. Use `aiAgents.list` to find the agent id first.",
      tags: ["AI Agents"],
      spec: mcpSpec({}),
    })
    .input(aiAgentIdParamSchema)
    .output(salesProfileStateResponseSchema)
    .errors(possibleErrorsOnFindingResource)
    .handler(
      async ({ context, input }) =>
        await aiAgentSalesProfileService.get({
          workspaceId: context.workspace.id,
          aiAgentId: input.id,
        }),
    ),

  update: workspaceTokenAuthAPI
    .route({
      method: "PUT",
      path: "/v1/ai-agents/{id}/sales-profile",
      summary: "Update AI agent sales profile",
      description:
        "Saves a complete sales profile for one AI agent (`source: manual`), increments `salesProfileVersion`, and appends an immutable entry to version history. Every `productId` in `targetProducts` must belong to the workspace and be active (`products.list`).",
      tags: ["AI Agents"],
      spec: mcpSpec({}),
    })
    .input(aiAgentIdParamSchema.and(updateSalesProfileRequestSchema))
    .output(updateSalesProfileResponseSchema)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const result = await aiAgentSalesProfileService.update({
        workspaceId: context.workspace.id,
        aiAgentId: input.id,
        profile: input.profile,
        source: "manual",
      })
      return {
        profile: result.profile,
        version: result.version,
        versionRecord: toPublicSalesProfileVersionResource(
          result.versionRecord,
        ),
      }
    }),

  propose: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/ai-agents/{id}/sales-profile/propose",
      summary: "Propose AI agent sales profile change",
      description:
        "Converts a natural-language instruction into a proposed sales profile and field-by-field diff without changing the active profile. Appends the instruction and proposal to the training chat history; pass the returned `proposedProfile` and `assistantMessage.id` to `aiAgents.salesProfile.apply` to activate it.",
      tags: ["AI Agents"],
      spec: mcpSpec({ readOnlyHint: false }),
    })
    .input(aiAgentIdParamSchema.and(proposeSalesProfileRequestSchema))
    .output(proposeSalesProfileResponseSchema)
    .errors(possibleErrorsOnProposingSalesProfile)
    .handler(async ({ context, input }) => {
      const result = await aiAgentSalesProfileProposalService.propose({
        workspaceId: context.workspace.id,
        aiAgentId: input.id,
        instruction: input.instruction,
        generatePatch: generateSalesProfileProposalPatch,
      })
      return {
        proposedProfile: result.proposedProfile,
        diff: result.diff,
        ...(result.clarifyingQuestion
          ? { clarifyingQuestion: result.clarifyingQuestion }
          : {}),
        ...(result.unmatchedProducts
          ? { unmatchedProducts: result.unmatchedProducts }
          : {}),
        adminMessage: toPublicTrainingMessageResource(result.adminMessage),
        assistantMessage: toPublicTrainingMessageResource(
          result.assistantMessage,
        ),
      }
    }),

  apply: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/ai-agents/{id}/sales-profile/apply",
      summary: "Apply AI agent sales profile proposal",
      description:
        "Validates and saves a proposed sales profile (`source: proposal`), increments `salesProfileVersion`, and marks the referenced training message (`messageId`) as applied with the new version number.",
      tags: ["AI Agents"],
      spec: mcpSpec({}),
    })
    .input(aiAgentIdParamSchema.and(applySalesProfileRequestSchema))
    .output(updateSalesProfileResponseSchema)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const result = await aiAgentSalesProfileService.update({
        workspaceId: context.workspace.id,
        aiAgentId: input.id,
        profile: input.profile,
        source: "proposal",
        instruction: input.instruction ?? null,
        messageId: input.messageId ?? null,
      })
      return {
        profile: result.profile,
        version: result.version,
        versionRecord: toPublicSalesProfileVersionResource(
          result.versionRecord,
        ),
      }
    }),

  versions: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/ai-agents/{id}/sales-profile/versions",
      summary: "List AI agent sales profile versions",
      description:
        "Lists the immutable sales profile version history for one AI agent from newest to oldest, cursor-paginated. Pass any version number to `aiAgents.salesProfile.revert` to restore it.",
      tags: ["AI Agents"],
      spec: mcpSpec({}),
    })
    .input(aiAgentIdParamSchema.and(listSalesProfileVersionsRequestSchema))
    .output(listSalesProfileVersionsResponseSchema)
    .errors(possibleErrorsOnFindingWithCursor)
    .handler(async ({ context, input }) => {
      const page = await aiAgentSalesProfileService.listVersions({
        workspaceId: context.workspace.id,
        aiAgentId: input.id,
        cursor: input.cursor,
        limit: input.limit,
      })
      return {
        items: page.items.map(toPublicSalesProfileVersionResource),
        nextCursor: page.nextCursor,
      }
    }),

  revert: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/ai-agents/{id}/sales-profile/revert",
      summary: "Revert AI agent sales profile",
      description:
        "Restores an earlier sales profile version by writing a new version entry (`source: revert`) with that snapshot and incrementing `salesProfileVersion`. Existing version history is preserved.",
      tags: ["AI Agents"],
      spec: mcpSpec({}),
    })
    .input(aiAgentIdParamSchema.and(revertSalesProfileRequestSchema))
    .output(updateSalesProfileResponseSchema)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const result = await aiAgentSalesProfileService.revert({
        workspaceId: context.workspace.id,
        aiAgentId: input.id,
        version: input.version,
      })
      return {
        profile: result.profile,
        version: result.version,
        versionRecord: toPublicSalesProfileVersionResource(
          result.versionRecord,
        ),
      }
    }),

  listTrainingMessages: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/ai-agents/{id}/training-messages",
      summary: "List AI agent training messages",
      description:
        "Lists the sales training chat messages and attached proposals for one AI agent from newest to oldest, cursor-paginated. Use `aiAgents.salesProfile.clearTrainingMessages` to reset the conversation.",
      tags: ["AI Agents"],
      spec: mcpSpec({}),
    })
    .input(aiAgentIdParamSchema.and(listTrainingMessagesRequestSchema))
    .output(listTrainingMessagesResponseSchema)
    .errors(possibleErrorsOnFindingWithCursor)
    .handler(async ({ context, input }) => {
      const page = await aiAgentSalesProfileService.listMessages({
        workspaceId: context.workspace.id,
        aiAgentId: input.id,
        cursor: input.cursor,
        limit: input.limit,
      })
      return {
        items: page.items.map(toPublicTrainingMessageResource),
        nextCursor: page.nextCursor,
      }
    }),

  clearTrainingMessages: workspaceTokenAuthAPI
    .route({
      method: "DELETE",
      path: "/v1/ai-agents/{id}/training-messages",
      summary: "Clear AI agent training messages",
      description:
        "Deletes all training chat messages for one AI agent while keeping the active sales profile and its version history intact.",
      successStatus: 204,
      tags: ["AI Agents"],
      spec: mcpSpec({}),
    })
    .input(aiAgentIdParamSchema)
    .errors(possibleErrorsOnDeletingResource)
    .handler(async ({ context, input }) => {
      await aiAgentSalesProfileService.clear({
        workspaceId: context.workspace.id,
        aiAgentId: input.id,
      })
    }),
}

export const aiAgentsPublicRouter = {
  list: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/ai-agents",
      summary: "List AI agents",
      description:
        "Use this to resolve an AI agent before referencing it in `flows.publish` or changing it with `aiAgents.update`. Returns the configured agents in the workspace. The bot reply delay shown in the agent list is not per agent: it is the workspace setting `smartResponseDelaySeconds`, shared by every agent (read it with `workspaceSettings.get`, change it with `workspaceSettings.update`).",
      tags: ["AI Agents"],
      spec: mcpSpec({ visibility: "default" }),
    })
    .input(publicListRequest)
    .output(publicListAIAgentsResponse)
    .errors(possibleErrorsOnListingResource)
    .handler(async ({ context, input }) => {
      const result = await aiAgentService.listAIAgents({
        workspaceId: context.workspace.id,
        ...input,
        sort: [{ id: "createdAt", desc: true }],
      })
      return { ...result, data: result.data.map(toPublicAIAgentResource) }
    }),

  get: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/ai-agents/{id}",
      summary: "Get AI agent",
      description:
        "Returns one AI agent's configuration. Use `aiAgents.list` to find its id first.",
      tags: ["AI Agents"],
    })
    .input(
      z.object({
        id: zodBigintAsString().describe(
          "AI agent id. Get it from `aiAgents.list`.",
        ),
      }),
    )
    .output(publicAIAgentResourceSchema)
    .errors(possibleErrorsOnFindingResource)
    .handler(async ({ context, input }) => {
      const aiAgent = await aiAgentService.findBy({
        where: { id: input.id, workspaceId: context.workspace.id },
      })
      if (!aiAgent) {
        throw notFoundException("AI agent not found")
      }
      return toPublicAIAgentResource(aiAgent)
    }),

  create: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/ai-agents",
      summary: "Create AI agent",
      description:
        "Adds a configured AI agent to the workspace. Use `aiAgents.list` first to avoid duplicating an existing agent, then use `aiAgents.update` to refine its settings.",
      successStatus: 201,
      tags: ["AI Agents"],
      spec: mcpSpec({ visibility: "default" }),
    })
    .input(createPublicAIAgentRequest)
    .output(publicAIAgentResourceSchema)
    .errors(possibleErrorsOnCreatingResource)
    .handler(async ({ context, input }) =>
      toPublicAIAgentResource(
        await aiAgentService.createAndReturn(context.workspace.id, input),
      ),
    ),

  update: workspaceTokenAuthAPI
    .route({
      method: "PATCH",
      path: "/v1/ai-agents/{id}",
      summary: "Update AI agent",
      description:
        "Changes settings on an existing AI agent without replacing unrelated fields. Call `aiAgents.list` to resolve its id, and use `aiAgents.get` to inspect the saved result. It does not change the bot reply delay: that is the workspace setting `smartResponseDelaySeconds` (`workspaceSettings.update`).",
      tags: ["AI Agents"],
      spec: mcpSpec({ visibility: "default" }),
    })
    .input(
      updatePublicAIAgentRequest.and(
        z.object({
          id: zodBigintAsString().describe(
            "AI agent id. Get it from `aiAgents.list`.",
          ),
        }),
      ),
    )
    .output(publicAIAgentResourceSchema)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const { id, ...data } = input
      return toPublicAIAgentResource(
        await aiAgentService.updateAIAgent(
          { workspaceId: context.workspace.id, id },
          data,
        ),
      )
    }),

  delete: workspaceTokenAuthAPI
    .route({
      method: "DELETE",
      path: "/v1/ai-agents/{id}",
      summary: "Delete AI agent",
      description:
        "Permanently deletes an AI agent. Use `aiAgents.list` to find its id first.",
      successStatus: 204,
      tags: ["AI Agents"],
    })
    .input(
      z.object({
        id: zodBigintAsString().describe(
          "AI agent id. Get it from `aiAgents.list`.",
        ),
      }),
    )
    .errors(possibleErrorsOnDeletingResource)
    .handler(async ({ context, input }) => {
      await aiAgentService.delete({
        workspaceId: context.workspace.id,
        ids: [input.id],
      })
    }),

  salesProfile: salesProfilePublicRouter,
}

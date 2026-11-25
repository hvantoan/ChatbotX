import { generateSalesProfileProposalPatch } from "@chatbotx.io/ai/sales-profile-proposer"
import {
  aiAgentSalesProfileProposalService,
  aiAgentSalesProfileService,
} from "@chatbotx.io/business"
import { hasWorkspacePermission } from "@chatbotx.io/business/workspace-member/permissions"
import { ORPCError } from "@orpc/server"
import { withWorkspaceIdSchema } from "@/features/workspaces/schema/resource"
import { possibleErrorsOnProposingSalesProfile } from "@/lib/orpc/orpc-error-helper"
import { workspaceAuthorizedMidddleware } from "@/middlewares/auth"
import { authorizedAPI } from "@/orpc"
import { listAIAgents } from "../queries"
import { listAIAgentsRequest, listAIAgentsResponse } from "../schema/query"
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

const assertAgentEditPermission = (
  workspaceMember:
    | { permissions: Parameters<typeof hasWorkspacePermission>[0] }
    | null
    | undefined,
) => {
  if (
    !(
      workspaceMember &&
      hasWorkspacePermission(workspaceMember.permissions, "flows")
    )
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "You do not have permission to edit AI agents",
    })
  }
}

const workspaceAgentScopedInput =
  withWorkspaceIdSchema.and(aiAgentIdParamSchema)

const listAIAgentsAPI = authorizedAPI
  .route({
    method: "GET",
    path: "/workspaces/{workspaceId}/ai-agents",
    summary: "List AI agents",
    tags: ["AI"],
  })
  .input(listAIAgentsRequest.and(withWorkspaceIdSchema))
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .output(listAIAgentsResponse)
  .handler(async ({ input }) => await listAIAgents(input))

const getSalesProfileAPI = authorizedAPI
  .route({
    method: "GET",
    path: "/workspaces/{workspaceId}/ai-agents/{id}/sales-profile",
    summary: "Get AI agent sales profile",
    tags: ["AI"],
  })
  .input(workspaceAgentScopedInput)
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .output(salesProfileStateResponseSchema)
  .handler(async ({ context, input }) => {
    assertAgentEditPermission(context.workspaceMember)
    return await aiAgentSalesProfileService.get({
      workspaceId: input.workspaceId,
      aiAgentId: input.id,
    })
  })

const updateSalesProfileAPI = authorizedAPI
  .route({
    method: "PUT",
    path: "/workspaces/{workspaceId}/ai-agents/{id}/sales-profile",
    summary: "Update AI agent sales profile",
    tags: ["AI"],
  })
  .input(workspaceAgentScopedInput.and(updateSalesProfileRequestSchema))
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .output(updateSalesProfileResponseSchema)
  .handler(async ({ context, input }) => {
    assertAgentEditPermission(context.workspaceMember)
    const result = await aiAgentSalesProfileService.update({
      workspaceId: input.workspaceId,
      aiAgentId: input.id,
      profile: input.profile,
      source: "manual",
      actorId: context.user.id,
    })
    return {
      profile: result.profile,
      version: result.version,
      versionRecord: toPublicSalesProfileVersionResource(result.versionRecord),
    }
  })

const proposeSalesProfileAPI = authorizedAPI
  .route({
    method: "POST",
    path: "/workspaces/{workspaceId}/ai-agents/{id}/sales-profile/propose",
    summary: "Propose AI agent sales profile change",
    tags: ["AI"],
  })
  .input(workspaceAgentScopedInput.and(proposeSalesProfileRequestSchema))
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .output(proposeSalesProfileResponseSchema)
  .errors(possibleErrorsOnProposingSalesProfile)
  .handler(async ({ context, input }) => {
    assertAgentEditPermission(context.workspaceMember)
    const result = await aiAgentSalesProfileProposalService.propose({
      workspaceId: input.workspaceId,
      aiAgentId: input.id,
      instruction: input.instruction,
      actorId: context.user.id,
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
  })

const applySalesProfileAPI = authorizedAPI
  .route({
    method: "POST",
    path: "/workspaces/{workspaceId}/ai-agents/{id}/sales-profile/apply",
    summary: "Apply AI agent sales profile proposal",
    tags: ["AI"],
  })
  .input(workspaceAgentScopedInput.and(applySalesProfileRequestSchema))
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .output(updateSalesProfileResponseSchema)
  .handler(async ({ context, input }) => {
    assertAgentEditPermission(context.workspaceMember)
    const result = await aiAgentSalesProfileService.update({
      workspaceId: input.workspaceId,
      aiAgentId: input.id,
      profile: input.profile,
      source: "proposal",
      instruction: input.instruction ?? null,
      messageId: input.messageId ?? null,
      actorId: context.user.id,
    })
    return {
      profile: result.profile,
      version: result.version,
      versionRecord: toPublicSalesProfileVersionResource(result.versionRecord),
    }
  })

const listSalesProfileVersionsAPI = authorizedAPI
  .route({
    method: "GET",
    path: "/workspaces/{workspaceId}/ai-agents/{id}/sales-profile/versions",
    summary: "List AI agent sales profile versions",
    tags: ["AI"],
  })
  .input(workspaceAgentScopedInput.and(listSalesProfileVersionsRequestSchema))
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .output(listSalesProfileVersionsResponseSchema)
  .handler(async ({ context, input }) => {
    assertAgentEditPermission(context.workspaceMember)
    const page = await aiAgentSalesProfileService.listVersions({
      workspaceId: input.workspaceId,
      aiAgentId: input.id,
      cursor: input.cursor,
      limit: input.limit,
    })
    return {
      items: page.items.map(toPublicSalesProfileVersionResource),
      nextCursor: page.nextCursor,
    }
  })

const revertSalesProfileAPI = authorizedAPI
  .route({
    method: "POST",
    path: "/workspaces/{workspaceId}/ai-agents/{id}/sales-profile/revert",
    summary: "Revert AI agent sales profile",
    tags: ["AI"],
  })
  .input(workspaceAgentScopedInput.and(revertSalesProfileRequestSchema))
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .output(updateSalesProfileResponseSchema)
  .handler(async ({ context, input }) => {
    assertAgentEditPermission(context.workspaceMember)
    const result = await aiAgentSalesProfileService.revert({
      workspaceId: input.workspaceId,
      aiAgentId: input.id,
      version: input.version,
      actorId: context.user.id,
    })
    return {
      profile: result.profile,
      version: result.version,
      versionRecord: toPublicSalesProfileVersionResource(result.versionRecord),
    }
  })

const listTrainingMessagesAPI = authorizedAPI
  .route({
    method: "GET",
    path: "/workspaces/{workspaceId}/ai-agents/{id}/training-messages",
    summary: "List AI agent training messages",
    tags: ["AI"],
  })
  .input(workspaceAgentScopedInput.and(listTrainingMessagesRequestSchema))
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .output(listTrainingMessagesResponseSchema)
  .handler(async ({ context, input }) => {
    assertAgentEditPermission(context.workspaceMember)
    const page = await aiAgentSalesProfileService.listMessages({
      workspaceId: input.workspaceId,
      aiAgentId: input.id,
      cursor: input.cursor,
      limit: input.limit,
    })
    return {
      items: page.items.map(toPublicTrainingMessageResource),
      nextCursor: page.nextCursor,
    }
  })

const clearTrainingMessagesAPI = authorizedAPI
  .route({
    method: "DELETE",
    path: "/workspaces/{workspaceId}/ai-agents/{id}/training-messages",
    summary: "Clear AI agent training messages",
    tags: ["AI"],
  })
  .input(workspaceAgentScopedInput)
  .use(workspaceAuthorizedMidddleware, (input) => input.workspaceId)
  .handler(async ({ context, input }) => {
    assertAgentEditPermission(context.workspaceMember)
    return await aiAgentSalesProfileService.clear({
      workspaceId: input.workspaceId,
      aiAgentId: input.id,
    })
  })

export const aiAgentsAuthenticatedAPI = {
  listAIAgentsAPI,
  getSalesProfileAPI,
  updateSalesProfileAPI,
  proposeSalesProfileAPI,
  applySalesProfileAPI,
  listSalesProfileVersionsAPI,
  revertSalesProfileAPI,
  listTrainingMessagesAPI,
  clearTrainingMessagesAPI,
}

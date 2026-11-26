import { integrationZaloPersonalService } from "@inboxos.io/business"
import { ORPCError } from "@orpc/server"
import { z } from "zod"
import {
  possibleErrorsOnDeletingResource,
  possibleErrorsOnFindingResource,
  possibleErrorsOnListingResource,
  possibleErrorsOnMutatingResource,
} from "@/lib/orpc/orpc-error-helper"
import { workspaceTokenAuthAPIForScope } from "@/orpc"
import {
  connectZaloPersonalWithCredentials,
  disconnectZaloPersonalChannel,
  syncZaloPersonalChannel,
  updateZaloPersonalChannel,
} from "../lib/manage-zalo-personal"
import {
  connectZaloPersonalCredentialsSchema,
  updateZaloPersonalSchema,
  zaloPersonalChannelIdRequest,
} from "../schema/mutation"
import { integrationZaloPersonalResource } from "../schema/resource"

const workspaceTokenAuthAPI = workspaceTokenAuthAPIForScope("channels")

export const zaloPersonalChannelsPublicRouter = {
  list: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/zalo-personal-channels",
      summary: "List Zalo Personal channels",
      description:
        "Lists connected personal Zalo accounts in this workspace. Credentials are never returned.",
      tags: ["Channels"],
    })
    .output(z.object({ data: z.array(integrationZaloPersonalResource) }))
    .errors(possibleErrorsOnListingResource)
    .handler(async ({ context }) => ({
      data: await integrationZaloPersonalService.listByWorkspaceId(
        context.workspace.id,
      ),
    })),

  get: workspaceTokenAuthAPI
    .route({
      method: "GET",
      path: "/v1/zalo-personal-channels/{id}",
      summary: "Get Zalo Personal channel",
      description:
        "Returns one connected personal Zalo account by id. Credentials are never returned.",
      tags: ["Channels"],
    })
    .input(zaloPersonalChannelIdRequest)
    .output(integrationZaloPersonalResource)
    .errors(possibleErrorsOnFindingResource)
    .handler(async ({ context, input }) => {
      const row = await integrationZaloPersonalService.findById({
        id: input.id,
        workspaceId: context.workspace.id,
      })
      if (!row) {
        throw new ORPCError("NOT_FOUND")
      }
      return row
    }),

  connect: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/zalo-personal-channels",
      summary: "Connect Zalo Personal channel",
      description:
        "Connects a personal Zalo account using IMEI, cookie JSON, and User-Agent credentials.",
      successStatus: 201,
      tags: ["Channels"],
    })
    .input(connectZaloPersonalCredentialsSchema)
    .output(integrationZaloPersonalResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      let parsedCookie: unknown
      try {
        parsedCookie = JSON.parse(input.cookie)
      } catch {
        throw new ORPCError("BAD_REQUEST", {
          message: "Cookie must be valid JSON",
        })
      }
      return await connectZaloPersonalWithCredentials({
        workspaceId: context.workspace.id,
        name: input.name,
        proxyUrl: input.proxyUrl || null,
        groupReplyConfig: input.groupReplyConfig,
        credentials: {
          imei: input.imei,
          cookie: parsedCookie,
          userAgent: input.userAgent,
        },
      })
    }),

  update: workspaceTokenAuthAPI
    .route({
      method: "PATCH",
      path: "/v1/zalo-personal-channels/{id}",
      summary: "Update Zalo Personal channel",
      description:
        "Updates display name, proxy URL, or group reply filter for a connected personal Zalo account.",
      tags: ["Channels"],
    })
    .input(zaloPersonalChannelIdRequest.merge(updateZaloPersonalSchema))
    .output(integrationZaloPersonalResource)
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const updated = await updateZaloPersonalChannel({
        workspaceId: context.workspace.id,
        id: input.id,
        name: input.name,
        proxyUrl: input.proxyUrl === "" ? null : input.proxyUrl,
        groupReplyConfig: input.groupReplyConfig,
      })
      if (!updated) {
        throw new ORPCError("NOT_FOUND")
      }
      return updated
    }),

  delete: workspaceTokenAuthAPI
    .route({
      method: "DELETE",
      path: "/v1/zalo-personal-channels/{id}",
      summary: "Disconnect Zalo Personal channel",
      description:
        "Disconnects a personal Zalo account, stops its gateway listener, and disconnects its inbox.",
      successStatus: 204,
      tags: ["Channels"],
    })
    .input(zaloPersonalChannelIdRequest)
    .errors(possibleErrorsOnDeletingResource)
    .handler(async ({ context, input }) => {
      await disconnectZaloPersonalChannel({
        workspaceId: context.workspace.id,
        id: input.id,
      })
    }),

  sync: workspaceTokenAuthAPI
    .route({
      method: "POST",
      path: "/v1/zalo-personal-channels/{id}/sync",
      summary: "Sync Zalo Personal contacts and conversations",
      description:
        "Adds every friend of a connected personal Zalo account as a contact (including friends with no messages; existing contacts are kept), then starts a background group message history sync. Returns how many friends were found and how many new contacts were created.",
      tags: ["Channels"],
    })
    .input(zaloPersonalChannelIdRequest)
    .output(
      z.object({
        ok: z.boolean(),
        friends: z.object({
          total: z.number().int().nonnegative(),
          imported: z.number().int().nonnegative(),
        }),
      }),
    )
    .errors(possibleErrorsOnMutatingResource)
    .handler(async ({ context, input }) => {
      const result = await syncZaloPersonalChannel({
        workspaceId: context.workspace.id,
        id: input.id,
      })
      if (!result) {
        throw new ORPCError("NOT_FOUND")
      }
      return result
    }),
}

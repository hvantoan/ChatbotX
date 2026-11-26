"use server"

import { platformCredentialService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import type { UserModel, WorkspaceModel } from "@inboxos.io/database/types"
import { HandleRequestType } from "@inboxos.io/sdk"
import { redirect } from "next/navigation"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { integrations } from "@/integration"
import { getOriginUrlFromHeader } from "@/lib/domain"
import { resolvePlatformOwnerId } from "@/lib/platform-credential-owner"
import { buildProviderCallbackUrl } from "@/lib/provider-origin"
import { workspaceActionClient } from "@/lib/safe-action"
import { connectExternalCalendarRequest } from "../schema/action"

export const connectGoogleCalendarAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(connectExternalCalendarRequest)
  .action(
    async ({
      ctx,
      parsedInput,
    }: {
      ctx: {
        user: UserModel
        workspace: WorkspaceModel
      }
      parsedInput: { referer: string }
    }) => {
      const ownerId = await resolvePlatformOwnerId({
        userId: ctx.user.id,
        workspaceId: ctx.workspace.id,
      })
      const googleCredential = await platformCredentialService.resolveForOwner({
        ownerId,
        type: "google",
      })
      if (!googleCredential) {
        throw new InboxOSException("Google App settings is not valid")
      }

      const originUrl = await getOriginUrlFromHeader()
      const authUrl = await integrations.googleCalendar.handleRequest?.({
        config: {
          ...googleCredential.config,
          redirectUrl: await buildProviderCallbackUrl(
            googleCredential,
            "/integrations/google-calendar/callback",
          ),
          stateParams: {
            workspaceId: ctx.workspace.id,
            referer: parsedInput.referer,
          },
        },
        req: new Request(new URL(HandleRequestType.generateAuthUrl, originUrl)),
      })

      if (typeof authUrl !== "string") {
        throw new InboxOSException("Failed to connect Google Calendar")
      }

      return redirect(authUrl)
    },
  )

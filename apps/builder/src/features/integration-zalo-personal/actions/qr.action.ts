"use server"

import {
  type WorkspaceIdRequestParams,
  workspaceIdrequestParams,
} from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { zaloPersonalGateway } from "../lib/gateway"
import { connectZaloPersonalWithCredentials } from "../lib/manage-zalo-personal"
import {
  pollZaloPersonalQrSchema,
  startZaloPersonalQrSchema,
} from "../schema/mutation"

export const startZaloPersonalQrAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(startZaloPersonalQrSchema)
  .action(
    async ({
      parsedInput,
    }: {
      bindArgsParsedInputs: WorkspaceIdRequestParams
      parsedInput: { proxyUrl?: string }
    }) => {
      const proxyUrl = parsedInput.proxyUrl || undefined
      return await zaloPersonalGateway.startQr(proxyUrl)
    },
  )

export const pollZaloPersonalQrAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(pollZaloPersonalQrSchema)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
    }: {
      bindArgsParsedInputs: WorkspaceIdRequestParams
      parsedInput: {
        sessionId: string
        name: string
        proxyUrl?: string
        groupReplyConfig?: {
          mode: "all" | "mentions" | "allowlist" | "disabled"
          allowedGroupIds?: string[]
        }
      }
    }) => {
      const status = await zaloPersonalGateway.getQrStatus(
        parsedInput.sessionId,
      )
      if (status.status !== "confirmed" || !status.credentials) {
        return {
          status: status.status,
          scannedUser: status.scannedUser ?? null,
          error: status.error ?? null,
          integration: null,
        }
      }

      const { imei, cookie, userAgent, zaloUid, displayName, avatar } =
        status.credentials

      const integration = await connectZaloPersonalWithCredentials({
        workspaceId,
        name: parsedInput.name || displayName,
        zaloUid,
        avatar,
        proxyUrl: parsedInput.proxyUrl || null,
        groupReplyConfig: parsedInput.groupReplyConfig,
        credentials: { imei, cookie, userAgent },
      })

      return {
        status: "confirmed" as const,
        scannedUser: status.scannedUser ?? null,
        error: null,
        integration,
      }
    },
  )

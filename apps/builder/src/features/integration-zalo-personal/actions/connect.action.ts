"use server"

import {
  type WorkspaceIdRequestParams,
  workspaceIdrequestParams,
} from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { connectZaloPersonalWithCredentials } from "../lib/manage-zalo-personal"
import { connectZaloPersonalCredentialsSchema } from "../schema/mutation"

export const connectZaloPersonalAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(connectZaloPersonalCredentialsSchema)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId],
      parsedInput,
    }: {
      bindArgsParsedInputs: WorkspaceIdRequestParams
      parsedInput: {
        name: string
        imei: string
        cookie: string
        userAgent: string
        proxyUrl?: string
        groupReplyConfig?: {
          mode: "all" | "mentions" | "allowlist" | "disabled"
          allowedGroupIds?: string[]
        }
      }
    }) => {
      let parsedCookie: unknown
      try {
        parsedCookie = JSON.parse(parsedInput.cookie)
      } catch {
        throw new Error("Cookie must be valid JSON")
      }

      return await connectZaloPersonalWithCredentials({
        workspaceId,
        name: parsedInput.name,
        proxyUrl: parsedInput.proxyUrl || null,
        groupReplyConfig: parsedInput.groupReplyConfig,
        credentials: {
          imei: parsedInput.imei,
          cookie: parsedCookie,
          userAgent: parsedInput.userAgent,
        },
      })
    },
  )

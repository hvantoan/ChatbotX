"use server"

import {
  type WorkspaceIdAndIdRequestParams,
  workspaceIdAndIdRequestParams,
} from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { updateZaloPersonalChannel } from "../lib/manage-zalo-personal"
import { updateZaloPersonalSchema } from "../schema/mutation"

export const updateZaloPersonalAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdAndIdRequestParams)
  .inputSchema(updateZaloPersonalSchema)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId, id],
      parsedInput,
    }: {
      bindArgsParsedInputs: WorkspaceIdAndIdRequestParams
      parsedInput: {
        name?: string
        proxyUrl?: string | null
        groupReplyConfig?: {
          mode: "all" | "mentions" | "allowlist" | "disabled"
          allowedGroupIds?: string[]
        }
      }
    }) =>
      await updateZaloPersonalChannel({
        workspaceId,
        id,
        name: parsedInput.name,
        proxyUrl: parsedInput.proxyUrl === "" ? null : parsedInput.proxyUrl,
        groupReplyConfig: parsedInput.groupReplyConfig,
      }),
  )

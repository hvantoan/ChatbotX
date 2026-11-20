"use server"

import {
  type WorkspaceIdAndIdRequestParams,
  workspaceIdAndIdRequestParams,
} from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { syncZaloPersonalChannel } from "../lib/manage-zalo-personal"

export const syncZaloPersonalAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdAndIdRequestParams)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId, id],
    }: {
      bindArgsParsedInputs: WorkspaceIdAndIdRequestParams
    }) => {
      const result = await syncZaloPersonalChannel({ workspaceId, id })
      if (!result) {
        throw new Error("Zalo personal channel not found")
      }
      return result
    },
  )

"use server"

import { workingHoursService } from "@inboxos.io/business"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { toWorkingHoursResource } from "../lib/to-resource"
import { createWorkingHoursRequest } from "../schema/action"

export const createWorkingHoursAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(createWorkingHoursRequest)
  .action(async (props) => {
    const {
      parsedInput,
      bindArgsParsedInputs: [workspaceId],
    } = props

    return toWorkingHoursResource(
      await workingHoursService.create({ workspaceId, data: parsedInput }),
    )
  })

"use server"

import { placeLocationService } from "@inboxos.io/business"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import { placeLocationFormSchema } from "../schema/action"

export const createPlaceLocationAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(placeLocationFormSchema)
  .action(
    async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) =>
      await placeLocationService.create({ workspaceId, ...parsedInput }),
  )

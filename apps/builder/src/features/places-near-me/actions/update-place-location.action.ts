"use server"

import { placeLocationService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { placeLocationFormSchema } from "../schema/action"

export const updatePlaceLocationAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(placeLocationFormSchema)
  .action(
    async ({ bindArgsParsedInputs: [workspaceId, locationId], parsedInput }) =>
      await placeLocationService.update({
        workspaceId,
        locationId,
        data: parsedInput,
      }),
  )

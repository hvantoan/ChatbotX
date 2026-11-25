"use server"

import { placeLocationService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

export const deletePlaceLocationAction = workspaceActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async ({ bindArgsParsedInputs: [workspaceId, locationId] }) => {
    await placeLocationService.delete({ workspaceId, locationId })
  })

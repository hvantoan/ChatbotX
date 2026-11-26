"use server"

import { productService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClient } from "@/lib/safe-action"
import { toggleProductActiveRequest } from "../schema/action"

export const toggleProductActiveAction = workspaceActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .inputSchema(toggleProductActiveRequest)
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId, productId],
      parsedInput: { isActive },
    }) => {
      await productService.update({
        productId,
        workspaceId,
        data: { status: isActive ? "active" : "draft" },
      })
    },
  )

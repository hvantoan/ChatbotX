"use server"

import { orderService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

/** The order with its lines, for the read-only Shopify details dialog. */
export const getOrderDetailAction = workspaceActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(
    async ({ bindArgsParsedInputs: [workspaceId, orderId] }) =>
      await orderService.getDetail({ workspaceId, orderId }),
  )

"use server"

import { orderService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

/** The same `orderService.delete` the `orders.delete` public procedure calls. */
export const deleteOrderAction = workspaceActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(async ({ bindArgsParsedInputs: [workspaceId, orderId] }) => {
    await orderService.delete({ workspaceId, orderId })
  })

"use server"

import { orderService } from "@inboxos.io/business"
import { workspaceIdrequestParams } from "@/features/common/schema"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"
import { exportOrdersRequest } from "../schema/action"

/** The same `orderService.exportCsv` the `orders.export` public procedure calls. */
export const exportOrdersAction = workspaceActionClientAllowExpired
  .bindArgsSchemas(workspaceIdrequestParams)
  .inputSchema(exportOrdersRequest)
  .action(
    async ({ bindArgsParsedInputs: [workspaceId], parsedInput }) =>
      await orderService.exportCsv({ ...parsedInput, workspaceId }),
  )

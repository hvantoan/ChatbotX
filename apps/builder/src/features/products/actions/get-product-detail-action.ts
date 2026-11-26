"use server"

import { productService } from "@inboxos.io/business"
import { zodBigintAsString } from "@inboxos.io/utils"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

/** The product with its variants, for the read-only Shopify details dialog. */
export const getProductDetailAction = workspaceActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(
    async ({ bindArgsParsedInputs: [workspaceId, productId] }) =>
      await productService.findById(productId, workspaceId),
  )

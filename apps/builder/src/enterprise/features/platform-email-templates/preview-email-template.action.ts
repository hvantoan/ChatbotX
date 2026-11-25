"use server"

import {
  assertEnterpriseFeatures,
  isPlatformAdmin,
  isSuperAdmin,
} from "@inboxos.io/business"
import type { UserModel } from "@inboxos.io/database/types"
import { compileEmailPreview } from "@inboxos.io/mail/preview"
import { z } from "zod"
import { authActionClient } from "@/lib/safe-action"

export const previewEmailTemplateAction = authActionClient
  .inputSchema(z.object({ body: z.string().max(100_000) }))
  .action(
    async ({
      ctx,
      parsedInput,
    }: {
      ctx: { user: UserModel }
      parsedInput: { body: string }
    }) => {
      await assertEnterpriseFeatures()
      if (
        !((await isSuperAdmin(ctx.user)) || (await isPlatformAdmin(ctx.user)))
      ) {
        throw new Error("Unauthorized")
      }
      return compileEmailPreview(parsedInput.body)
    },
  )

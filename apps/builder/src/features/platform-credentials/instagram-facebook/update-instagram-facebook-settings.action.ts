"use server"

import { platformCredentialService } from "@inboxos.io/business"
import {
  type InstagramFacebookCredential,
  instagramFacebookCredentialUpdateSchema,
} from "@inboxos.io/database/partials"

import { authActionClient } from "@/lib/safe-action"
import { credentialScopeSchema, resolveCredentialScopedUserId } from "../scope"

export const updateInstagramFacebookSettingAction = authActionClient
  .bindArgsSchemas([credentialScopeSchema])
  .inputSchema(instagramFacebookCredentialUpdateSchema)
  .action(async ({ ctx, bindArgsParsedInputs: [scope], parsedInput }) => {
    const scopedUserId = await resolveCredentialScopedUserId(ctx.user, scope)
    const config: InstagramFacebookCredential = {
      clientId: parsedInput.clientId,
      version: parsedInput.version,
      verifyToken: parsedInput.verifyToken,
      clientSecret: parsedInput.clientSecret,
    }

    await platformCredentialService.upsert({
      userId: scopedUserId,
      type: "instagramFacebook",
      config,
    })
  })

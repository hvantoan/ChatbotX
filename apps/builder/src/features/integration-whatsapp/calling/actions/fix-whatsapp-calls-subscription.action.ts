"use server"

import {
  integrationWhatsappService,
  platformCredentialService,
  workspaceService,
} from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import type { WhatsappAuthValue } from "@inboxos.io/integration-whatsapp"
import { zodBigintAsString } from "@inboxos.io/utils"
import { getTranslations } from "next-intl/server"
import { ensureWhatsappAppWebhookFields } from "@/features/integration-whatsapp/libs/ensure-app-webhook-fields"
import { assertWorkspaceSuperAdmin } from "@/lib/auth/assert-workspace-super-admin"
import { resolveOwnerForWorkspace } from "@/lib/platform-credential-owner"
import { callingAdminActionClient } from "@/lib/safe-action"

/**
 * Runs the same app-level `calls` webhook subscription used after
 * save-settings/reconnect, on demand from the Calls-card
 * preflight's "Fix" button. Super-admin only — the button itself is also
 * gated client-side, but the action re-asserts so it is never exploitable
 * by calling it directly.
 */
export const fixWhatsappCallsSubscriptionAction = callingAdminActionClient
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId, integrationWhatsappId],
    }: {
      bindArgsParsedInputs: readonly [string, string]
    }) => {
      const t = await getTranslations()
      await assertWorkspaceSuperAdmin(workspaceId)

      const [workspace, integrationWhatsapp] = await Promise.all([
        workspaceService.findById({ id: workspaceId }),
        integrationWhatsappService.findByIdForWorkspace({
          id: integrationWhatsappId,
          workspaceId,
        }),
      ])
      if (!(workspace && integrationWhatsapp)) {
        throw new InboxOSException(t("whatsapp.calls.errors.notFound"))
      }

      const auth = integrationWhatsapp.auth as WhatsappAuthValue
      if (auth.metadata.isManual) {
        throw new InboxOSException(
          t("whatsapp.calls.preflight.manualIntegrationNotice"),
        )
      }

      const credential = await platformCredentialService.resolveForOwner({
        ownerId: await resolveOwnerForWorkspace(workspace),
        type: "whatsapp",
      })
      if (!credential) {
        throw new InboxOSException(
          t("whatsapp.connect.errors.appSettingsNotFound"),
        )
      }

      const result = await ensureWhatsappAppWebhookFields({
        appId: credential.config.clientId,
        appSecret: credential.config.clientSecret,
        verifyToken: credential.config.verifyToken,
      })

      if (result.status === "no-subscription") {
        throw new InboxOSException(
          t("whatsapp.calls.preflight.appSubscriptionMissing"),
        )
      }

      return { status: result.status }
    },
  )

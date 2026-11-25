"use server"

import {
  integrationWhatsappService,
  metaConversionsService,
} from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { zodBigintAsString } from "@inboxos.io/utils"
import { getTranslations } from "next-intl/server"
import { assertWorkspaceSuperAdmin } from "@/lib/auth/assert-workspace-super-admin"
import { workspaceActionClientAllowExpired } from "@/lib/safe-action"

export const disconnectWhatsappCapiAction = workspaceActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString()])
  .action(
    async ({
      bindArgsParsedInputs: [workspaceId, integrationId],
    }: {
      bindArgsParsedInputs: readonly [string, string]
    }) => {
      const t = await getTranslations("metaConversions.errors")
      await assertWorkspaceSuperAdmin(workspaceId)

      const integration = await integrationWhatsappService.findByIdForWorkspace(
        {
          id: integrationId,
          workspaceId,
        },
      )
      if (!integration) {
        throw new InboxOSException(t("whatsappNotFound"))
      }

      await metaConversionsService.disconnectCapi({
        channel: "whatsapp",
        integration,
      })

      return { success: true }
    },
  )

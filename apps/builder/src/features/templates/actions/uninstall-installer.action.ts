"use server"

import { templateUninstallService } from "@inboxos.io/business/template-uninstall"
import { zodBigintAsString } from "@inboxos.io/utils"
import { z } from "zod"
import { PUBLISHER_REF_FORMAT } from "../schema/shared"
import { templateActionClientAllowExpired } from "./template-action-client"

const installerRef = z.string().trim().regex(PUBLISHER_REF_FORMAT)

export const previewUninstallInstallerAction = templateActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString(), installerRef])
  .action(
    async ({
      ctx: { templateActor },
      bindArgsParsedInputs: [workspaceId, templateId, publisherRef],
    }) =>
      await templateUninstallService.previewAsPublisher({
        workspaceId,
        templateId,
        publisherRef,
        actor: templateActor,
      }),
  )

export const uninstallInstallerAction = templateActionClientAllowExpired
  .bindArgsSchemas([zodBigintAsString(), zodBigintAsString(), installerRef])
  .action(
    async ({
      ctx: { templateActor, user },
      bindArgsParsedInputs: [workspaceId, templateId, publisherRef],
    }) =>
      await templateUninstallService.uninstallAsPublisher({
        workspaceId,
        templateId,
        publisherRef,
        actor: templateActor,
        // Named in the audit summary of the operation.
        requestedBy: user.id,
      }),
  )

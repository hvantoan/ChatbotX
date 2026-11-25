import { workspaceService } from "@inboxos.io/business"
import type { DatabaseClient } from "@inboxos.io/database/client"
import { uploadFileFromUrl } from "@inboxos.io/filesystem"
import type { AuthValue, Context } from "@inboxos.io/sdk"
import { createId } from "@inboxos.io/utils"

type ProfilePicProvider<A extends AuthValue> = {
  runChannelHandler(
    group: "bot",
    name: "getProfilePictureUrl",
    props: { ctx: Context<A> },
  ): Promise<string | undefined>
}

export async function updateWorkspaceLogo<A extends AuthValue>(props: {
  id: string
  integration: ProfilePicProvider<A>
  ctx: Context<A>
  tx?: DatabaseClient
}): Promise<void> {
  const { id, integration, ctx, tx } = props

  const currentLogo = await workspaceService.findLogo({ id, tx })
  if (currentLogo === undefined || currentLogo) {
    return
  }

  let logo: string | undefined
  try {
    const url = await integration.runChannelHandler(
      "bot",
      "getProfilePictureUrl",
      {
        ctx,
      },
    )
    if (!url) {
      return
    }

    const uploaded = await uploadFileFromUrl(
      url,
      `public/space/${id}/logos/${createId()}.jpg`,
    )
    logo = uploaded.originPath
  } catch {
    return
  }

  if (!logo) {
    return
  }

  await workspaceService.setLogoIfEmpty({ id, logo, tx })
}

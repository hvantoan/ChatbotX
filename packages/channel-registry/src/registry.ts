import {
  buildContext,
  type IntegrationContext,
  inboxService,
  integrationThreadsService,
  workspaceService,
} from "@inboxos.io/business"
import { findOrFail } from "@inboxos.io/database/client"
import type { IntegrationType } from "@inboxos.io/database/partials"
import { integrationLookupRepository } from "@inboxos.io/database/repositories"
import { inboxModel } from "@inboxos.io/database/schema"
import type {
  ContactInboxModel,
  InboxModel,
  WorkspaceModel,
} from "@inboxos.io/database/types"
import { integration as integrationActiveCampaign } from "@inboxos.io/integration-active-campaign"
import { integration as integrationApi } from "@inboxos.io/integration-api"
import { integration as integrationDrip } from "@inboxos.io/integration-drip"
import { integration as integrationFacebookAds } from "@inboxos.io/integration-facebook-ads"
import { integration as integrationGetResponse } from "@inboxos.io/integration-get-response"
import { integration as integrationGoogleAds } from "@inboxos.io/integration-google-ads"
import { integration as integrationGoogleCalendar } from "@inboxos.io/integration-google-calendar"
import { integration as integrationGoogleSheets } from "@inboxos.io/integration-google-sheets"
import { integration as integrationChatbotx } from "@inboxos.io/integration-inboxos"
import { integration as integrationInstagram } from "@inboxos.io/integration-instagram"
import { integration as integrationInstagramFacebook } from "@inboxos.io/integration-instagram-facebook"
import { integration as integrationKlaviyo } from "@inboxos.io/integration-klaviyo"
import { integration as integrationLine } from "@inboxos.io/integration-line"
import { integration as integrationMailchimp } from "@inboxos.io/integration-mailchimp"
import { integration as integrationMailerLite } from "@inboxos.io/integration-mailer-lite"
import { integration as integrationMessenger } from "@inboxos.io/integration-messenger"
import { integration as integrationMoosend } from "@inboxos.io/integration-moosend"
import { integration as integrationSendGrid } from "@inboxos.io/integration-sendgrid"
import { integration as integrationSmtp } from "@inboxos.io/integration-smtp"
import { integration as integrationTelegram } from "@inboxos.io/integration-telegram"
import { integration as integrationThreads } from "@inboxos.io/integration-threads"
import { integration as integrationTiktok } from "@inboxos.io/integration-tiktok"
import { integration as integrationWebchat } from "@inboxos.io/integration-webchat"
import { integration as integrationWhatsapp } from "@inboxos.io/integration-whatsapp"
import { integration as integrationZalo } from "@inboxos.io/integration-zalo"
import { integration as integrationZaloPersonal } from "@inboxos.io/integration-zalo-personal"
import {
  type AuthValue,
  type BaseConfig,
  ChannelError,
  ChannelErrorCategory,
  type Integration,
  type IntegrationDefinition,
  SdkException,
} from "@inboxos.io/sdk"
import { IntegrationNotFoundError } from "./errors"

export { IntegrationNotFoundError } from "./errors"

export const integrations = {
  activeCampaign: integrationActiveCampaign,
  api: integrationApi,
  chatbotx: integrationChatbotx,
  drip: integrationDrip,
  facebookAds: integrationFacebookAds,
  getResponse: integrationGetResponse,
  googleAds: integrationGoogleAds,
  googleCalendar: integrationGoogleCalendar,
  googleSheets: integrationGoogleSheets,
  instagram: integrationInstagram,
  instagramFacebook: integrationInstagramFacebook,
  klaviyo: integrationKlaviyo,
  line: integrationLine,
  mailchimp: integrationMailchimp,
  mailerLite: integrationMailerLite,
  messenger: integrationMessenger,
  moosend: integrationMoosend,
  sendGrid: integrationSendGrid,
  smtp: integrationSmtp,
  telegram: integrationTelegram,
  threads: integrationThreads,
  tiktok: integrationTiktok,
  webchat: integrationWebchat,
  whatsapp: integrationWhatsapp,
  zalo: integrationZalo,
  zalo_personal: integrationZaloPersonal,
} as const

export type IntegrationKey = keyof typeof integrations

export type ResolvedIntegration = Integration<
  IntegrationDefinition<BaseConfig, AuthValue>
>

const registeredIntegrations = {
  ...integrations,
  gemini: undefined,
  openai: undefined,
}

export const allIntegrations = registeredIntegrations as unknown as Record<
  string,
  ResolvedIntegration | undefined
> &
  Pick<typeof registeredIntegrations, "messenger" | "threads">

export const getRegisteredIntegration = (
  integrationType: string,
): ResolvedIntegration | undefined => allIntegrations[integrationType]

export type IntegrationRow = {
  id: string
  auth: AuthValue
  inboxId: string
  type?: string
  [key: string]: unknown
}

export function isInstagramViaFacebook(row: IntegrationRow): boolean {
  return row.type === "facebook"
}

export const integrationService = {
  identifyInboxAndIntegrationAuthFromIdentifier: async (
    integrationType: IntegrationType,
    integrationIdentifier: string,
  ): Promise<{
    workspace: WorkspaceModel
    inbox: InboxModel
    integrationRow: IntegrationRow
  }> => {
    if (integrationType === "threads") {
      const integrationRow =
        await integrationThreadsService.findByThreadsUserId(
          integrationIdentifier,
        )

      if (!integrationRow) {
        throw new IntegrationNotFoundError(
          integrationType,
          integrationIdentifier,
        )
      }

      const [workspace, inbox] = await Promise.all([
        workspaceService.findById({ id: integrationRow.workspaceId }),
        inboxService.find({ where: { id: integrationRow.inboxId } }),
      ])

      if (!inbox) {
        throw new IntegrationNotFoundError(
          integrationType,
          integrationIdentifier,
        )
      }

      return {
        integrationRow: {
          ...integrationRow,
          auth: integrationRow.auth as AuthValue,
        },
        workspace,
        inbox,
      }
    }

    let modelName: string
    let columnName: string

    switch (integrationType) {
      case "whatsapp": {
        modelName = "IntegrationWhatsapp"
        columnName = "phoneNumberId"
        break
      }
      case "telegram": {
        modelName = "IntegrationTelegram"
        columnName = "botId"
        break
      }
      case "line": {
        modelName = "IntegrationLine"
        columnName = "channelId"
        break
      }
      case "messenger": {
        modelName = "IntegrationMessenger"
        columnName = "pageId"
        break
      }
      case "zalo": {
        modelName = "IntegrationZalo"
        columnName = "oaId"
        break
      }
      case "zalo_personal": {
        modelName = "IntegrationZaloPersonal"
        columnName = "zaloUid"
        break
      }
      case "instagram":
      case "instagramFacebook": {
        modelName = "IntegrationInstagram"
        columnName = "igId"
        break
      }
      case "tiktok": {
        modelName = "IntegrationTiktok"
        columnName = "openId"
        break
      }
      case "webchat": {
        modelName = "IntegrationWebchat"
        columnName = "inboxId"
        break
      }
      case "api": {
        modelName = "IntegrationApi"
        columnName = "inboxId"
        break
      }
      default:
        throw new Error(`Unsupported integration: ${integrationType}`)
    }

    const row = await integrationLookupRepository.findAuthByIdentifier({
      modelName,
      columnName,
      identifier: integrationIdentifier,
    })

    if (!row) {
      throw new IntegrationNotFoundError(integrationType, integrationIdentifier)
    }

    const integrationRow = row as IntegrationRow & { workspaceId: string }
    const workspace = await workspaceService.findById({
      id: integrationRow.workspaceId,
    })
    const inbox = await findOrFail({
      table: inboxModel,
      where: { id: integrationRow.inboxId },
      message: "Inbox not found",
    })

    return { integrationRow, workspace, inbox }
  },

  getIntegrationFromContactInbox: async (
    contactInbox: ContactInboxRoute,
  ): Promise<IntegrationRow> => {
    if (contactInbox.channel === "threads") {
      const integrationRow = await integrationThreadsService.findByInboxId(
        contactInbox.inboxId,
      )

      if (!integrationRow) {
        throw new ChannelError(
          `Unable to find integration auth for channel: ${contactInbox.channel}`,
          ChannelErrorCategory.AUTH_FAILED,
          { code: "integration_auth_missing" },
        )
      }

      return {
        ...integrationRow,
        auth: integrationRow.auth as AuthValue,
      }
    }

    const integrationTableByChannel: Partial<Record<string, string>> = {
      api: "IntegrationApi",
      instagram: "IntegrationInstagram",
      line: "IntegrationLine",
      messenger: "IntegrationMessenger",
      smtp: "IntegrationSmtp",
      telegram: "IntegrationTelegram",
      tiktok: "IntegrationTiktok",
      webchat: "IntegrationWebchat",
      whatsapp: "IntegrationWhatsapp",
      zalo: "IntegrationZalo",
      zalo_personal: "IntegrationZaloPersonal",
    }
    const integrationTable = integrationTableByChannel[contactInbox.channel]
    if (!integrationTable) {
      throw new ChannelError(
        `Unsupported integration channel: ${contactInbox.channel}`,
        ChannelErrorCategory.AUTH_FAILED,
        { code: "unsupported_channel" },
      )
    }

    const row = await integrationLookupRepository.findAuthByInboxId({
      modelName: integrationTable,
      inboxId: contactInbox.inboxId,
    })

    if (!row) {
      throw new ChannelError(
        `Unable to find integration auth for channel: ${contactInbox.channel}`,
        ChannelErrorCategory.AUTH_FAILED,
        { code: "integration_auth_missing" },
      )
    }

    return row as IntegrationRow
  },
}

/** What locates a contact's integration: its channel and inbox, nothing else. */
export type ContactInboxRoute = Pick<ContactInboxModel, "channel" | "inboxId">

export type ResolvedIntegrationContext = {
  integration: ResolvedIntegration
  ctx: IntegrationContext
  integrationRow: Awaited<
    ReturnType<typeof integrationService.getIntegrationFromContactInbox>
  >
}

export async function resolveIntegrationContextFromContactInbox(args: {
  workspaceId: string
  contactInbox: ContactInboxRoute
}): Promise<ResolvedIntegrationContext> {
  let integration = getRegisteredIntegration(args.contactInbox.channel)
  if (!integration) {
    throw new SdkException(
      `No integration registered for channel: ${args.contactInbox.channel}`,
    )
  }

  const integrationRow =
    await integrationService.getIntegrationFromContactInbox(args.contactInbox)

  if (
    args.contactInbox.channel === "instagram" &&
    isInstagramViaFacebook(integrationRow)
  ) {
    integration = getRegisteredIntegration("instagramFacebook") ?? integration
  }

  return {
    integration,
    integrationRow,
    ctx: await buildContext({
      workspaceId: args.workspaceId,
      integrationType: args.contactInbox.channel,
      integration: integrationRow,
    }),
  }
}

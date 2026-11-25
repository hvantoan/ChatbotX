import {
  apiConnectConfigSchema,
  integrationApiService,
  integrationWebchatService,
  webchatConnectConfigSchema,
} from "@inboxos.io/business"
import {
  CONNECTION_STORE_BINDINGS,
  type ConnectionAdapter,
  type ConnectionRegistry,
  claudeConnectionProvider,
  deepseekConnectionProvider,
  geminiConnectionProvider,
  museConnectionProvider,
  openaiCompatibleConnectionProvider,
  openaiConnectionProvider,
  openrouterConnectionProvider,
} from "@inboxos.io/business/connection"
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
import type { Integration, IntegrationDefinition } from "@inboxos.io/sdk"
import { messengerConnectionTeardownHook } from "./messenger-teardown"

type StoreBindingKey = keyof typeof CONNECTION_STORE_BINDINGS

type StoreBoundAdapter<Key extends StoreBindingKey> = ConnectionAdapter & {
  readonly storeKey: Key
}

type StoreBoundConnectionRegistry = {
  [Key in keyof ConnectionRegistry]: Key extends StoreBindingKey
    ? StoreBoundAdapter<Key> | null
    : ConnectionAdapter | null
}

/**
 * Builds a `ConnectionAdapter` from an `integrations/<name>` SDK package's
 * `Integration` instance. Throws at module-load time (not per-request) if
 * the provider's `connection` block is missing — every `IntegrationType`
 * wired into this registry is asserted, at registration time, to have one;
 * a provider that regresses to having none fails the build immediately
 * instead of silently returning `undefined` behind an optional chain.
 */
const fromIntegration = <Key extends StoreBindingKey>(
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous registry
  integration: Integration<IntegrationDefinition<any, any, any>>,
  storeKey: Key,
  credentialType?: ConnectionAdapter["credentialType"],
): StoreBoundAdapter<Key> => {
  if (integration.name !== storeKey) {
    throw new Error(
      `@inboxos.io/connections: integration "${integration.name}" cannot use store binding "${storeKey}"`,
    )
  }
  const provider = integration.connection
  if (!provider) {
    throw new Error(
      `@inboxos.io/connections: "${integration.name}" has no connection block registered under CONNECTION_REGISTRY.${storeKey}`,
    )
  }
  const store = CONNECTION_STORE_BINDINGS[storeKey] ?? undefined
  return { integration, provider, store, credentialType, storeKey }
}

/**
 * A credential-only provider (no `integrations/` package) paired with its
 * store binding — the same shape `fromIntegration` produces, minus the SDK
 * `Integration` wrapper these providers never had.
 */
const fromCredentialProvider = <Key extends StoreBindingKey>(
  provider: ConnectionAdapter["provider"],
  storeKey: Key,
): StoreBoundAdapter<Key> => {
  const store = CONNECTION_STORE_BINDINGS[storeKey]
  if (!store) {
    throw new Error(
      `@inboxos.io/connections: no store binding for "${storeKey}"`,
    )
  }
  return { provider, store, storeKey }
}

const connectWebchat: NonNullable<ConnectionAdapter["connect"]> = async (
  input,
) => {
  const data = webchatConnectConfigSchema.parse(input.config)
  const { actorUserId } = input.actor
  const result = await integrationWebchatService.createWithWorkspace({
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    createdBy: actorUserId ?? input.ownerId,
    actorUserId,
    workspaceName: data.name,
    data: {
      ...data,
      auth: {},
      customCss: data.customCss ?? null,
    },
  })
  return { connection: result.connection }
}

const connectApi: NonNullable<ConnectionAdapter["connect"]> = async (input) => {
  const { callbackUrl, name } = apiConnectConfigSchema.parse(input.config)
  const result = await integrationApiService.createWithToken({
    ownerId: input.ownerId,
    actorUserId: input.actor.actorUserId,
    workspaceId: input.workspaceId,
    name,
    callbackUrl,
  })
  return {
    connection: result.connection,
    secret: { kind: "api_channel_token", token: result.token },
  }
}

/**
 * Compile-time exhaustive `Record<IntegrationType, ConnectionAdapter | null>`.
 * `null` marks a type with no connect lifecycle yet: `metaCatalog` and
 * `outlookCalendar` have no live builder feature or supported connection
 * engine path. `chatbotx` DOES have a real adapter (its `store` is
 * `undefined` — it has no satellite table; the `Inbox` row is the whole
 * connection).
 */
export const CONNECTION_REGISTRY: StoreBoundConnectionRegistry = {
  activeCampaign: fromIntegration(integrationActiveCampaign, "activeCampaign"),
  api: {
    ...fromIntegration(integrationApi, "api"),
    connect: connectApi,
  },
  chatbotx: fromIntegration(integrationChatbotx, "chatbotx"),
  claude: fromCredentialProvider(claudeConnectionProvider, "claude"),
  deepseek: fromCredentialProvider(deepseekConnectionProvider, "deepseek"),
  drip: fromIntegration(integrationDrip, "drip"),
  facebookAds: fromIntegration(
    integrationFacebookAds,
    "facebookAds",
    "messenger",
  ),
  gemini: fromCredentialProvider(geminiConnectionProvider, "gemini"),
  getResponse: fromIntegration(integrationGetResponse, "getResponse"),
  googleAds: fromIntegration(integrationGoogleAds, "googleAds", "googleAds"),
  googleCalendar: fromIntegration(
    integrationGoogleCalendar,
    "googleCalendar",
    "google",
  ),
  googleSheets: fromIntegration(
    integrationGoogleSheets,
    "googleSheets",
    "google",
  ),
  instagram: fromIntegration(integrationInstagram, "instagram", "instagram"),
  instagramFacebook: fromIntegration(
    integrationInstagramFacebook,
    "instagramFacebook",
    "instagramFacebook",
  ),
  klaviyo: fromIntegration(integrationKlaviyo, "klaviyo"),
  mailchimp: fromIntegration(integrationMailchimp, "mailchimp"),
  mailerLite: fromIntegration(integrationMailerLite, "mailerLite"),
  messenger: {
    ...fromIntegration(integrationMessenger, "messenger", "messenger"),
    teardown: messengerConnectionTeardownHook,
  },
  metaCatalog: null,
  moosend: fromIntegration(integrationMoosend, "moosend"),
  muse: fromCredentialProvider(museConnectionProvider, "muse"),
  openai: fromCredentialProvider(openaiConnectionProvider, "openai"),
  openaiCompatible: fromCredentialProvider(
    openaiCompatibleConnectionProvider,
    "openaiCompatible",
  ),
  openrouter: fromCredentialProvider(
    openrouterConnectionProvider,
    "openrouter",
  ),
  outlookCalendar: null,
  sendGrid: fromIntegration(integrationSendGrid, "sendGrid"),
  smtp: fromIntegration(integrationSmtp, "smtp"),
  line: fromIntegration(integrationLine, "line"),
  telegram: fromIntegration(integrationTelegram, "telegram"),
  threads: fromIntegration(integrationThreads, "threads", "threads"),
  tiktok: fromIntegration(integrationTiktok, "tiktok", "tiktok"),
  webchat: {
    ...fromIntegration(integrationWebchat, "webchat"),
    connect: connectWebchat,
  },
  whatsapp: fromIntegration(integrationWhatsapp, "whatsapp", "whatsapp"),
  zalo: fromIntegration(integrationZalo, "zalo", "zalo"),
  zalo_personal: fromIntegration(integrationZaloPersonal, "zalo_personal"),
}

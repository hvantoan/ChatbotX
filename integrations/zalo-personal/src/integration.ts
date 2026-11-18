import {
  HandleRequestType,
  Integration,
  type IntegrationDefinition,
  probeVerify,
} from "@chatbotx.io/sdk"
import { ZaloPersonalAPIException } from "./exception"
import { contactHandlers } from "./handlers/contact"
import { conversationHandlers } from "./handlers/conversation"
import { messageHandlers } from "./handlers/message"
import { webhookHandler } from "./handlers/webhook"
import { gatewayClient } from "./lib/gateway-client"
import type {
  ZaloPersonalActions,
  ZaloPersonalAuthValue,
  ZaloPersonalConfig,
} from "./schema"

const config: IntegrationDefinition<
  ZaloPersonalConfig,
  ZaloPersonalAuthValue,
  ZaloPersonalActions
> = {
  name: "zalo_personal",
  channels: {
    channel: {
      message: messageHandlers,
      conversation: conversationHandlers,
      contact: contactHandlers,
    },
  },
  actions: {},
  connection: {
    kind: "channel",
    strategy: "self_serve",
    multiAccount: false,
    // No `fromCredentials`: a bare `zaloUid` proves no ownership — anyone
    // could squat another person's account on the global UID constraint.
    // Real connects go through the credential-verify or QR flows, which log
    // the account in on the gateway before a row is written (and also carry
    // the webhook secret this path could never provide).
    configFields: [],
    describe: (auth) => ({
      sourceId: auth.zaloUid,
      displayName: "Zalo Personal",
    }),
    verify: async ({ auth }) =>
      await probeVerify(() => gatewayClient.getAccountStatus(auth.zaloUid), {
        label: "Zalo Personal gateway session",
      }),
  },
  handleRequest: async (props) => {
    const action = new URL(props.req.url).pathname.split("/").pop()
    switch (action) {
      case HandleRequestType.webhook:
        return await webhookHandler(props)
      default:
        throw new ZaloPersonalAPIException(
          `${props.req.method} ${props.req.url} is not implemented`,
        )
    }
  },
  disconnect: async (auth: ZaloPersonalAuthValue): Promise<void> => {
    await gatewayClient.stopAccount(auth.zaloUid)
  },
}

export const integration = new Integration<
  IntegrationDefinition<
    ZaloPersonalConfig,
    ZaloPersonalAuthValue,
    ZaloPersonalActions
  >
>(config)

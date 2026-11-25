"use server"

import { telegramIntegrationService } from "@inboxos.io/business"
import { auditService } from "@inboxos.io/business/audit"
import { InboxOSException } from "@inboxos.io/business/errors"
import type { UserModel } from "@inboxos.io/database/types"
import { redirect } from "next/navigation"
import { resolveConnectOwnerId } from "@/features/channel-connect/lib/resolve-connect-owner"
import { integrations } from "@/integration"
import { logger } from "@/lib/log"
import { buildBrokerCallbackUrl } from "@/lib/oauth-broker"
import { authActionClient } from "@/lib/safe-action"
import {
  type ConnectTelegramRequest,
  connectTelegramRequest,
} from "../schema/request"

export const connectTelegramAction = authActionClient
  .inputSchema(connectTelegramRequest)
  .action(
    async ({
      parsedInput,
      ctx,
    }: {
      parsedInput: ConnectTelegramRequest
      ctx: { user: UserModel }
    }) => {
      try {
        const workspaceId = parsedInput.workspaceId ?? undefined

        // Validate bot token and fetch bot info from Telegram
        const botData = await integrations.telegram.runAction("connect", {
          botToken: parsedInput.botToken,
        })

        // Resolve ownerId before the transaction to avoid an extra read inside it
        const ownerId = await resolveConnectOwnerId({
          workspaceId,
          user: ctx.user,
        })

        const result = await telegramIntegrationService.connect({
          workspaceId,
          ownerId,
          createdBy: ctx.user.id,
          botId: botData.id,
          botUsername: botData.username,
          botToken: parsedInput.botToken,
          onConnected: async ({ webhookSecretToken }) => {
            // Register webhook URL with Telegram
            const webhookUrl = buildBrokerCallbackUrl(
              `/integrations/telegram/webhook?botId=${botData.id}`,
            )
            await integrations.telegram.runAction("registerWebhook", {
              botToken: parsedInput.botToken,
              webhookUrl,
              secretToken: webhookSecretToken,
            })
          },
        })

        if (result.createdWorkspace) {
          await auditService.record({
            userId: ctx.user.id,
            workspaceId: result.workspaceId,
            action: "create",
            detail: `created the workspace (#${result.workspaceId})`,
          })
        }

        if (result.wasCreated) {
          await auditService.record({
            workspaceId: result.workspaceId,
            action: "connect",
            detail: `connected a new Telegram channel (#${result.integrationId})`,
          })
        }

        return { workspaceId: result.workspaceId }
      } catch (error) {
        if (error instanceof InboxOSException) {
          if (error.code === "channelDuplicated" && parsedInput.workspaceId) {
            redirect(
              `/space/${parsedInput.workspaceId}/settings/channels?channel=telegram&error=duplicated`,
            )
          }
          throw error
        }

        logger.error(error, "Failed to connect Telegram bot")
        throw new InboxOSException(
          "Failed to connect Telegram. Please check the bot token and try again.",
        )
      }
    },
  )

"use server"

import type { OpenaiCompatibleProviderPreset } from "@chatbotx.io/ai"
import {
  integrationOpenaiCompatibleService,
  isOpenaiCompatiblePresetAlreadyConnectedError,
  isOpenaiCompatibleProviderUnreachableError,
} from "@chatbotx.io/business"
import { ChatbotXException } from "@chatbotx.io/business/errors"
import { getTranslations } from "next-intl/server"
import { returnValidationErrors } from "next-safe-action"
import {
  type WorkspaceIdAndIdRequestParams,
  workspaceIdAndIdRequestParams,
} from "@/features/common/schema"
import { workspaceActionClient } from "@/lib/safe-action"
import {
  resolveOpenaiCompatibleDefaultModel,
  type UpdateOpenaiCompatibleEnabledSchema,
  type UpdateOpenaiCompatibleSchema,
  updateOpenaiCompatibleEnabledSchema,
  updateOpenaiCompatibleSchema,
} from "../schema/request"

export const updateOpenaiCompatibleEnabledAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdAndIdRequestParams)
  .inputSchema(updateOpenaiCompatibleEnabledSchema)
  .action(
    async ({
      parsedInput,
      bindArgsParsedInputs: [workspaceId, integrationId],
    }: {
      parsedInput: UpdateOpenaiCompatibleEnabledSchema
      bindArgsParsedInputs: WorkspaceIdAndIdRequestParams
    }) => {
      try {
        await integrationOpenaiCompatibleService.updateWithVerification(
          workspaceId,
          integrationId,
          parsedInput,
        )
      } catch (error) {
        await rethrowTranslatedConflictError(error)
      }
    },
  )

export const updateOpenaiCompatibleAction = workspaceActionClient
  .bindArgsSchemas(workspaceIdAndIdRequestParams)
  .inputSchema(updateOpenaiCompatibleSchema)
  .action(
    async ({
      parsedInput,
      bindArgsParsedInputs: [workspaceId, integrationId],
    }: {
      parsedInput: UpdateOpenaiCompatibleSchema
      bindArgsParsedInputs: WorkspaceIdAndIdRequestParams
    }) => {
      const t = await getTranslations()
      const apiKey = parsedInput.apiKey?.trim()

      try {
        await integrationOpenaiCompatibleService.updateWithVerification(
          workspaceId,
          integrationId,
          {
            ...parsedInput,
            apiKey: apiKey || undefined,
            resolveDefaultModel: (preset) =>
              resolveOpenaiCompatibleDefaultModel({
                preset: preset as OpenaiCompatibleProviderPreset,
              }),
          },
        )
      } catch (error) {
        if (isOpenaiCompatibleProviderUnreachableError(error)) {
          return returnValidationErrors(updateOpenaiCompatibleSchema, {
            baseURL: {
              _errors: [t("openaiCompatible.validation.providerUnreachable")],
            },
          })
        }
        if (isBaseUrlValidationError(error)) {
          return returnValidationErrors(updateOpenaiCompatibleSchema, {
            baseURL: {
              _errors: [t("openaiCompatible.validation.invalidBaseURL")],
            },
          })
        }
        if (
          error instanceof ChatbotXException &&
          error.code === "connectionCredentialsRejected"
        ) {
          return returnValidationErrors(updateOpenaiCompatibleSchema, {
            apiKey: {
              _errors: [t("validation.invalidApiKey")],
            },
          })
        }
        if (
          error instanceof ChatbotXException &&
          error.code === "validation" &&
          error.field === "apiKey"
        ) {
          return returnValidationErrors(updateOpenaiCompatibleSchema, {
            apiKey: {
              _errors: [t("validation.invalidApiKey")],
            },
          })
        }
        if (
          error instanceof ChatbotXException &&
          error.code === "connectionAlreadyConnected"
        ) {
          return returnValidationErrors(updateOpenaiCompatibleSchema, {
            baseURL: {
              _errors: [
                t("openaiCompatible.validation.baseUrlAlreadyConnected"),
              ],
            },
          })
        }
        if (error instanceof ChatbotXException && error.code === "conflict") {
          throw new ChatbotXException(
            t("openaiCompatible.errors.updateConflict"),
            "conflict",
            409,
          )
        }
        if (isOpenaiCompatiblePresetAlreadyConnectedError(error)) {
          return returnValidationErrors(updateOpenaiCompatibleSchema, {
            preset: {
              _errors: [
                t("openaiCompatible.validation.presetAlreadyConnected"),
              ],
            },
          })
        }
        throw error
      }
    },
  )

const isBaseUrlValidationError = (error: unknown): error is ChatbotXException =>
  error instanceof ChatbotXException &&
  (error.code === "invalidBaseUrl" || error.code === "ssrfBlocked")

const rethrowTranslatedConflictError = async (error: unknown) => {
  if (error instanceof ChatbotXException && error.code === "conflict") {
    const t = await getTranslations()
    throw new ChatbotXException(
      t("openaiCompatible.errors.updateConflict"),
      "conflict",
      409,
    )
  }
  throw error
}

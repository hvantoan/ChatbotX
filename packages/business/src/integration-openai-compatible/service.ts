import { and, db, eq, isDatabaseError } from "@chatbotx.io/database/client"
import {
  connectionModel,
  integrationModel,
  integrationOpenaiCompatibleModel,
} from "@chatbotx.io/database/schema"
import {
  AuthType,
  type SecretTextAuthValue,
  secretTextAuthSchema,
} from "@chatbotx.io/sdk"
import { createId } from "@chatbotx.io/utils"
import { BaseService } from "../base.service"
import {
  ChatbotXException,
  connectionAlreadyConnectedException,
  connectionCredentialsRejectedException,
  notFoundException,
  validationException,
} from "../errors"
import {
  normalizeOpenaiCompatibleBaseUrl,
  validateOpenaiCompatibleBaseUrlForEnvironment,
} from "./validate-base-url"
import { verifyOpenaiCompatibleProvider } from "./verify"

const PRESET_UNIQUE_INDEX = "IntegrationOpenaiCompatible_workspaceId_preset_key"
const CONNECTION_SOURCE_UNIQUE_INDEX =
  "Connection_workspaceId_provider_sourceId_key"

export class OpenaiCompatiblePresetAlreadyConnectedError extends ChatbotXException {
  constructor() {
    super(
      "OpenAI-compatible preset is already connected",
      "presetAlreadyConnected",
      409,
    )
    this.name = "OpenaiCompatiblePresetAlreadyConnectedError"
  }
}

export const isOpenaiCompatiblePresetAlreadyConnectedError = (
  error: unknown,
): error is OpenaiCompatiblePresetAlreadyConnectedError =>
  error instanceof OpenaiCompatiblePresetAlreadyConnectedError ||
  (error instanceof ChatbotXException &&
    error.code === "presetAlreadyConnected")

const isUniqueConstraintViolation = (
  error: unknown,
  constraint: string,
): boolean =>
  isDatabaseError(error) &&
  error.cause.code === "23505" &&
  "constraint" in error.cause &&
  error.cause.constraint === constraint

const isPresetUniqueViolation = (error: unknown): boolean =>
  isUniqueConstraintViolation(error, PRESET_UNIQUE_INDEX)

const isConnectionSourceUniqueViolation = (error: unknown): boolean =>
  isUniqueConstraintViolation(error, CONNECTION_SOURCE_UNIQUE_INDEX)

export type ConnectOpenaiCompatibleInput = {
  workspaceId: string
  name: string
  preset: string
  baseURL: string
  defaultModel: string
  apiKey: string
  autoReply?: boolean
  enabled?: boolean
}

export type UpdateOpenaiCompatibleInput = Partial<
  Omit<ConnectOpenaiCompatibleInput, "workspaceId">
>

export type UpdateOpenaiCompatibleWithVerificationInput =
  UpdateOpenaiCompatibleInput & {
    resolveDefaultModel?: (preset: string) => string
  }

class IntegrationOpenaiCompatibleService extends BaseService {
  listByWorkspaceId(workspaceId: string) {
    return db.query.integrationOpenaiCompatibleModel.findMany({
      where: { workspaceId },
      orderBy: (table, { asc }) => [asc(table.createdAt)],
    })
  }

  findByWorkspaceIdAndId(props: { workspaceId: string; id: string }) {
    return db.query.integrationOpenaiCompatibleModel.findFirst({
      where: { workspaceId: props.workspaceId, id: props.id },
    })
  }

  findByWorkspaceIdAndIntegrationId(props: {
    workspaceId: string
    integrationId: string
  }) {
    return db.query.integrationOpenaiCompatibleModel.findFirst({
      where: {
        workspaceId: props.workspaceId,
        integrationId: props.integrationId,
      },
    })
  }

  async findByWorkspaceIdAndAnyId(props: { workspaceId: string; id: string }) {
    const bySatelliteId = await this.findByWorkspaceIdAndId(props)
    if (bySatelliteId) {
      return bySatelliteId
    }
    return await this.findByWorkspaceIdAndIntegrationId({
      workspaceId: props.workspaceId,
      integrationId: props.id,
    })
  }

  private async ensurePresetAvailable(props: {
    workspaceId: string
    preset?: string
    excludeId?: string
  }) {
    if (!props.preset || props.preset === "custom") {
      return
    }

    const existing = await db.query.integrationOpenaiCompatibleModel.findMany({
      where: {
        workspaceId: props.workspaceId,
        preset: props.preset,
      },
      columns: { id: true },
    })

    if (existing.some((row) => row.id !== props.excludeId)) {
      throw new OpenaiCompatiblePresetAlreadyConnectedError()
    }
  }

  async connect(props: ConnectOpenaiCompatibleInput) {
    const auth = this.createAuth(props.apiKey)
    const baseURL = await validateOpenaiCompatibleBaseUrlForEnvironment(
      props.baseURL,
    )

    await this.ensurePresetAvailable({
      workspaceId: props.workspaceId,
      preset: props.preset,
    })

    try {
      await db.transaction(async (tx) => {
        const [integration] = await tx
          .insert(integrationModel)
          .values({
            id: createId(),
            workspaceId: props.workspaceId,
            integrationType: "openaiCompatible",
          })
          .returning()

        if (!integration) {
          throw new Error("Failed to create integration record")
        }

        await tx.insert(integrationOpenaiCompatibleModel).values({
          id: createId(),
          auth,
          autoReply: props.autoReply ?? false,
          baseURL,
          defaultModel: props.defaultModel,
          enabled: props.enabled ?? true,
          integrationId: integration.id,
          name: props.name,
          preset: props.preset,
          workspaceId: props.workspaceId,
        })
      })
    } catch (error) {
      if (isPresetUniqueViolation(error)) {
        throw new OpenaiCompatiblePresetAlreadyConnectedError()
      }
      if (isConnectionSourceUniqueViolation(error)) {
        throw connectionAlreadyConnectedException()
      }
      throw error
    }

    await this.audit("connect", "connected a new OpenAI-compatible integration")
  }

  async update(
    workspaceId: string,
    id: string,
    data: UpdateOpenaiCompatibleInput,
  ) {
    const existing = await this.findByWorkspaceIdAndId({ workspaceId, id })
    if (!existing) {
      throw notFoundException("OpenAI-compatible integration not found")
    }

    await this.ensurePresetAvailable({
      workspaceId,
      preset: data.preset,
      excludeId: id,
    })

    const { apiKey, baseURL: rawBaseURL, ...rest } = data
    const trimmedApiKey = apiKey?.trim()
    const baseURL =
      rawBaseURL === undefined
        ? undefined
        : await validateOpenaiCompatibleBaseUrlForEnvironment(
            normalizeOpenaiCompatibleBaseUrl(rawBaseURL),
          )

    const updateValues = {
      ...rest,
      ...(baseURL === undefined ? {} : { baseURL }),
      ...(trimmedApiKey ? { auth: this.createAuth(trimmedApiKey) } : {}),
    }
    if (Object.values(updateValues).every((value) => value === undefined)) {
      return existing
    }

    let updatedRow: typeof existing | undefined
    try {
      updatedRow = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(integrationOpenaiCompatibleModel)
          .set(updateValues)
          .where(
            and(
              eq(integrationOpenaiCompatibleModel.id, id),
              eq(integrationOpenaiCompatibleModel.workspaceId, workspaceId),
            ),
          )
          .returning()

        if (baseURL !== undefined || rest.name !== undefined) {
          await tx
            .update(connectionModel)
            .set({
              ...(baseURL === undefined ? {} : { sourceId: baseURL }),
              ...(rest.name === undefined ? {} : { displayName: rest.name }),
            })
            .where(
              and(
                eq(connectionModel.workspaceId, workspaceId),
                eq(connectionModel.provider, "openaiCompatible"),
                eq(connectionModel.integrationId, existing.integrationId),
              ),
            )
        }

        return row
      })
    } catch (error) {
      if (isPresetUniqueViolation(error)) {
        throw new OpenaiCompatiblePresetAlreadyConnectedError()
      }
      if (isConnectionSourceUniqueViolation(error)) {
        throw connectionAlreadyConnectedException()
      }
      throw error
    }

    await this.audit(
      "update",
      "updated the OpenAI-compatible integration configuration",
    )

    return updatedRow ?? existing
  }

  async updateWithVerification(
    workspaceId: string,
    id: string,
    data: UpdateOpenaiCompatibleWithVerificationInput,
  ) {
    const existing = await this.findByWorkspaceIdAndId({ workspaceId, id })
    if (!existing) {
      throw notFoundException("OpenAI-compatible integration not found")
    }

    await this.ensurePresetAvailable({
      workspaceId,
      preset: data.preset,
      excludeId: id,
    })

    const { resolveDefaultModel, apiKey, baseURL: rawBaseURL, ...rest } = data
    const trimmedApiKey = apiKey?.trim()

    let validatedBaseUrl: string | undefined
    if (rawBaseURL !== undefined) {
      const normalizedCandidate = normalizeOpenaiCompatibleBaseUrl(rawBaseURL)
      const existingOrigin = new URL(
        normalizeOpenaiCompatibleBaseUrl(existing.baseURL),
      ).origin
      const candidateOrigin = new URL(normalizedCandidate).origin
      if (candidateOrigin !== existingOrigin && !trimmedApiKey) {
        throw validationException(
          "apiKey",
          "Provide an API key when changing baseURL to a different origin.",
        )
      }
      validatedBaseUrl =
        await validateOpenaiCompatibleBaseUrlForEnvironment(normalizedCandidate)
    }

    if (trimmedApiKey || validatedBaseUrl !== undefined) {
      const effectiveBaseUrl =
        validatedBaseUrl ??
        (await validateOpenaiCompatibleBaseUrlForEnvironment(existing.baseURL))
      const existingAuth = secretTextAuthSchema.safeParse(existing.auth)
      const verifyResult = await verifyOpenaiCompatibleProvider({
        apiKey:
          trimmedApiKey ||
          (existingAuth.success ? existingAuth.data.secretText : undefined),
        baseURL: effectiveBaseUrl,
      })

      if (!verifyResult.ok) {
        if (verifyResult.reason === "unsafe_base_url") {
          throw new ChatbotXException(
            "OpenAI-compatible base URL is not allowed.",
            "ssrfBlocked",
            400,
          )
        }
        throw connectionCredentialsRejectedException(
          "OpenAI-compatible API key was rejected.",
        )
      }
    }

    const shouldResolveDefaultModel =
      rest.defaultModel === undefined &&
      rest.preset !== undefined &&
      rest.preset !== existing.preset &&
      resolveDefaultModel !== undefined

    return await this.update(workspaceId, id, {
      ...rest,
      ...(validatedBaseUrl === undefined ? {} : { baseURL: validatedBaseUrl }),
      ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
      ...(shouldResolveDefaultModel
        ? { defaultModel: resolveDefaultModel(rest.preset as string) }
        : {}),
    })
  }

  async disconnect(workspaceId: string, id: string) {
    const existing = await this.findByWorkspaceIdAndId({ workspaceId, id })
    if (!existing) {
      return
    }
    await db
      .delete(integrationModel)
      .where(eq(integrationModel.id, existing.integrationId))

    await this.audit(
      "disconnect",
      "disconnected the OpenAI-compatible integration",
    )
  }

  private createAuth(apiKey?: string | null): SecretTextAuthValue | null {
    const secretText = apiKey?.trim()
    if (!secretText) {
      return null
    }
    return {
      authType: AuthType.secretText,
      secretText,
    }
  }
}

export const integrationOpenaiCompatibleService =
  new IntegrationOpenaiCompatibleService()

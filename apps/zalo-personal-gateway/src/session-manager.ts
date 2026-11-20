import { createHmac } from "node:crypto"
import {
  type API,
  CloseReason,
  type Credentials,
  type GroupMessage,
  type Message,
  ThreadType,
  type UserMessage,
  Zalo,
} from "zca-js"
import type { LockHandle, RedisListenerLock } from "./lock"
import { logger } from "./logger"
import { createProxyAgent, createProxyFetch } from "./proxy"

export type AccountCredentials = {
  imei: string
  cookie: Credentials["cookie"]
  userAgent: string
}

export type StartAccountInput = {
  integrationId: string
  zaloUid: string
  credentials: AccountCredentials
  proxyUrl?: string
  webhookUrl: string
  webhookSecret?: string
}

export type AccountConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"

export type NormalizedWebhookAttachment = {
  type: "image" | "video" | "audio" | "file"
  url: string
  name?: string
}

export type NormalizedWebhookPayload = {
  zaloUid: string
  integrationId: string
  threadId: string
  threadType: "user" | "group"
  senderId: string
  senderName: string
  messageId: string
  text: string
  attachments: NormalizedWebhookAttachment[]
  isMentionedMe: boolean
  isSelf: boolean
  timestamp: number
  isHistorySync?: boolean
  threadName?: string
  threadAvatar?: string
  senderAvatar?: string
}

export type SendMessageInput = {
  zaloUid: string
  threadId: string
  threadType: "user" | "group"
  text?: string
  attachments?: Array<{
    url: string
    filename: string
    fileType: "image" | "video" | "audio" | "file"
  }>
}

const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60_000
const LOCK_RENEW_INTERVAL_MS = 10_000

export function calculateBackoffMs(
  attempt: number,
  baseMs: number = BASE_BACKOFF_MS,
  maxMs: number = MAX_BACKOFF_MS,
): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt))
  const jitter = Math.floor(exponential * 0.2 * Math.random())
  return Math.min(maxMs, exponential + jitter)
}

export function signWebhookPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex")
}

function resolveAttachmentType(
  msgType: string,
): "image" | "video" | "audio" | "file" {
  if (msgType.includes("photo") || msgType.includes("image")) {
    return "image"
  }
  if (msgType.includes("video")) {
    return "video"
  }
  if (msgType.includes("voice") || msgType.includes("audio")) {
    return "audio"
  }
  return "file"
}

export type NormalizeMessageOptions = {
  allowSelf?: boolean
  isHistorySync?: boolean
  threadName?: string
  threadAvatar?: string
  senderAvatar?: string
}

export function normalizeMessage(
  msg: Message,
  zaloUid: string,
  integrationId: string,
  options?: NormalizeMessageOptions,
): NormalizedWebhookPayload | null {
  if (msg.isSelf && !options?.allowSelf) {
    return null
  }

  const isGroup = msg.type === ThreadType.Group
  const data = msg.data
  const content = data.content

  let text = ""
  const attachments: NormalizedWebhookAttachment[] = []

  if (typeof content === "string") {
    text = content
  } else if (content && typeof content === "object") {
    if ("title" in content && typeof content.title === "string") {
      text = content.title
    }
    if ("href" in content && typeof content.href === "string" && content.href) {
      const attachmentType = resolveAttachmentType(data.msgType ?? "")
      attachments.push({
        type: attachmentType,
        url: content.href,
        name:
          "title" in content && typeof content.title === "string"
            ? content.title
            : undefined,
      })
    }
  }

  const mentions = isGroup ? (msg as GroupMessage).data.mentions : undefined
  const isMentionedMe = Array.isArray(mentions)
    ? mentions.some((m) => m.uid === zaloUid)
    : false

  return {
    zaloUid,
    integrationId,
    threadId: msg.threadId,
    threadType: isGroup ? "group" : "user",
    senderId: data.uidFrom,
    senderName: data.dName || data.uidFrom,
    messageId: data.msgId || data.cliMsgId,
    text,
    attachments,
    isMentionedMe,
    isSelf: msg.isSelf,
    timestamp: Number(data.ts) || Date.now(),
    ...(options?.isHistorySync ? { isHistorySync: true } : {}),
    ...(options?.threadName ? { threadName: options.threadName } : {}),
    ...(options?.threadAvatar ? { threadAvatar: options.threadAvatar } : {}),
    ...(options?.senderAvatar ? { senderAvatar: options.senderAvatar } : {}),
  }
}

export function normalizeIncomingMessage(
  msg: Message,
  zaloUid: string,
  integrationId: string,
): NormalizedWebhookPayload | null {
  return normalizeMessage(msg, zaloUid, integrationId)
}

type ManagedSession = {
  input: StartAccountInput
  api: API | null
  lock: LockHandle | null
  renewTimer: ReturnType<typeof setInterval> | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  state: AccountConnectionState
  reconnectAttempts: number
  lastError?: string
  stopped: boolean
  initialSyncDone: boolean
  syncInProgress: boolean
}

export class ZaloSessionManager {
  private readonly sessions = new Map<string, ManagedSession>()
  private readonly lockManager: RedisListenerLock
  private readonly options: {
    maxAccounts: number
    defaultProxyUrl?: string
    defaultWebhookSecret?: string
  }

  constructor(
    lockManager: RedisListenerLock,
    options: {
      maxAccounts: number
      defaultProxyUrl?: string
      defaultWebhookSecret?: string
    },
  ) {
    this.lockManager = lockManager
    this.options = options
  }

  getStatus(zaloUid: string): {
    zaloUid: string
    state: AccountConnectionState
    reconnectAttempts: number
    lastError?: string
  } {
    const session = this.sessions.get(zaloUid)
    if (!session) {
      return {
        zaloUid,
        state: "disconnected",
        reconnectAttempts: 0,
      }
    }
    return {
      zaloUid,
      state: session.state,
      reconnectAttempts: session.reconnectAttempts,
      ...(session.lastError ? { lastError: session.lastError } : {}),
    }
  }

  getActiveCount(): number {
    return this.sessions.size
  }

  async startAccount(input: StartAccountInput): Promise<{
    zaloUid: string
    state: AccountConnectionState
  }> {
    const existing = this.sessions.get(input.zaloUid)
    if (existing && !existing.stopped && existing.state === "connected") {
      // Update webhook config if changed
      existing.input = input
      return { zaloUid: input.zaloUid, state: existing.state }
    }

    if (!existing && this.sessions.size >= this.options.maxAccounts) {
      throw new Error(
        `Maximum active personal Zalo accounts (${this.options.maxAccounts}) reached`,
      )
    }

    if (existing) {
      await this.stopAccount(input.zaloUid)
    }

    const session: ManagedSession = {
      input,
      api: null,
      lock: null,
      renewTimer: null,
      reconnectTimer: null,
      state: "connecting",
      reconnectAttempts: 0,
      stopped: false,
      initialSyncDone: false,
      syncInProgress: false,
    }
    this.sessions.set(input.zaloUid, session)

    await this.connectSession(session)
    return { zaloUid: input.zaloUid, state: session.state }
  }

  private async connectSession(session: ManagedSession): Promise<void> {
    if (session.stopped) {
      return
    }

    const {
      zaloUid,
      credentials,
      proxyUrl,
      webhookUrl,
      webhookSecret,
      integrationId,
    } = session.input

    const lock = await this.lockManager.acquire(zaloUid)
    if (!lock) {
      session.state = "error"
      session.lastError = "Another gateway instance holds the listener lock"
      logger.warn({ zaloUid }, "Failed to acquire Redis listener lock")
      return
    }
    session.lock = lock
    session.renewTimer = setInterval(async () => {
      const ok = await lock.renew()
      if (!(ok || session.stopped)) {
        logger.warn({ zaloUid }, "Lost Redis listener lock; stopping session")
        await this.stopAccount(zaloUid)
      }
    }, LOCK_RENEW_INTERVAL_MS)

    const effectiveProxy = proxyUrl ?? this.options.defaultProxyUrl
    const zalo = new Zalo({
      selfListen: false,
      checkUpdate: false,
      logging: false,
      ...(effectiveProxy
        ? {
            agent: createProxyAgent(effectiveProxy),
            polyfill: createProxyFetch(effectiveProxy),
          }
        : {}),
    })

    try {
      const api = await zalo.login(credentials)
      if (session.stopped) {
        return
      }
      session.api = api
      session.state = "connected"
      session.reconnectAttempts = 0
      session.lastError = undefined

      api.listener.on("message", (msg: UserMessage | GroupMessage) => {
        const normalized = normalizeIncomingMessage(msg, zaloUid, integrationId)
        if (!normalized) {
          return
        }
        this.forwardWebhook(
          webhookUrl,
          webhookSecret ?? this.options.defaultWebhookSecret,
          normalized,
        ).catch(() => undefined)
      })

      api.listener.on(
        "old_messages",
        (messages: Message[], threadType: ThreadType) => {
          this.handleOldMessages(session, messages, threadType).catch(
            (err: unknown) => {
              logger.warn(
                { err, zaloUid, threadType },
                "Failed to process Zalo personal old_messages batch",
              )
            },
          )
        },
      )

      api.listener.on("error", (err: unknown) => {
        logger.error({ err, zaloUid }, "Zalo listener error")
        session.lastError =
          err instanceof Error ? err.message : "Listener error"
      })

      api.listener.on("closed", (code: CloseReason, reason: string) => {
        logger.warn({ zaloUid, code, reason }, "Zalo listener closed")
        if (session.stopped) {
          return
        }
        if (
          code === CloseReason.DuplicateConnection ||
          code === CloseReason.KickConnection
        ) {
          session.state = "error"
          session.lastError = `Connection kicked or duplicated (${code}): ${reason}`
          this.cleanupLockOnly(session).catch(() => undefined)
          return
        }
        session.state = "disconnected"
        this.scheduleReconnect(session)
      })

      api.listener.start({ retryOnClose: false })
      logger.info({ zaloUid, integrationId }, "Started Zalo personal listener")

      if (!session.initialSyncDone) {
        session.initialSyncDone = true
        this.syncHistory(zaloUid).catch((err: unknown) => {
          logger.warn(
            { err, zaloUid },
            "Initial Zalo personal history sync failed",
          )
        })
      }
    } catch (err) {
      session.state = "error"
      session.lastError =
        err instanceof Error ? err.message : "Failed to connect Zalo session"
      logger.error({ err, zaloUid }, "Failed to login Zalo personal session")
      await this.cleanupLockOnly(session)
      throw err
    }
  }

  private scheduleReconnect(session: ManagedSession): void {
    if (session.stopped || session.reconnectTimer) {
      return
    }
    const delayMs = calculateBackoffMs(session.reconnectAttempts)
    session.reconnectAttempts += 1
    logger.info(
      {
        zaloUid: session.input.zaloUid,
        attempt: session.reconnectAttempts,
        delayMs,
      },
      "Scheduling Zalo personal reconnect",
    )
    session.reconnectTimer = setTimeout(async () => {
      session.reconnectTimer = null
      if (session.stopped) {
        return
      }
      await this.cleanupLockOnly(session)
      try {
        await this.connectSession(session)
      } catch {
        this.scheduleReconnect(session)
      }
    }, delayMs)
  }

  private async cleanupLockOnly(session: ManagedSession): Promise<void> {
    if (session.renewTimer) {
      clearInterval(session.renewTimer)
      session.renewTimer = null
    }
    if (session.lock) {
      await session.lock.release()
      session.lock = null
    }
  }

  syncHistory(zaloUid: string): Promise<{ ok: boolean }> {
    const session = this.sessions.get(zaloUid)
    if (
      !session ||
      session.stopped ||
      !session.api ||
      session.state !== "connected"
    ) {
      return Promise.reject(new Error("Zalo personal session is not connected"))
    }
    if (session.syncInProgress) {
      return Promise.resolve({ ok: true })
    }
    session.syncInProgress = true
    setTimeout(() => {
      session.syncInProgress = false
    }, 15_000).unref?.()

    session.api.listener.requestOldMessages(ThreadType.User)
    session.api.listener.requestOldMessages(ThreadType.Group)
    return Promise.resolve({ ok: true })
  }

  private async enrichThreadMetadata(
    api: API,
    messages: Message[],
    threadType: ThreadType,
  ): Promise<Map<string, { name?: string; avatar?: string }>> {
    const metadata = new Map<string, { name?: string; avatar?: string }>()
    const uniqueIds = Array.from(
      new Set(messages.map((m) => m.threadId).filter(Boolean)),
    )
    const chunkSize = 20

    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
      const chunk = uniqueIds.slice(i, i + chunkSize)
      try {
        if (threadType === ThreadType.Group) {
          const res = await api.getGroupInfo(chunk)
          for (const [id, info] of Object.entries(res.gridInfoMap ?? {})) {
            metadata.set(id, { name: info.name, avatar: info.avt })
          }
        } else {
          const res = await api.getUserInfo(chunk)
          for (const [id, info] of Object.entries(res.changed_profiles ?? {})) {
            metadata.set(id, {
              name: info.displayName || info.zaloName,
              avatar: info.avatar,
            })
          }
        }
      } catch (err) {
        logger.warn(
          { err, threadType, count: chunk.length },
          "Failed to enrich Zalo thread metadata",
        )
      }
      if (i + chunkSize < uniqueIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }

    return metadata
  }

  private async handleOldMessages(
    session: ManagedSession,
    messages: Message[],
    threadType: ThreadType,
  ): Promise<void> {
    try {
      if (session.stopped || !session.api || messages.length === 0) {
        return
      }
      const { zaloUid, integrationId, webhookUrl, webhookSecret } =
        session.input
      const secret = webhookSecret ?? this.options.defaultWebhookSecret
      const metadata = await this.enrichThreadMetadata(
        session.api,
        messages,
        threadType,
      )

      for (const msg of messages) {
        if (session.stopped) {
          break
        }
        const meta = metadata.get(msg.threadId)
        const normalized = normalizeMessage(msg, zaloUid, integrationId, {
          allowSelf: true,
          isHistorySync: true,
          threadName: meta?.name,
          threadAvatar: meta?.avatar,
        })
        if (!normalized) {
          continue
        }
        await this.forwardWebhook(webhookUrl, secret, normalized).catch(
          (err: unknown) => {
            logger.warn(
              { err, zaloUid, messageId: normalized.messageId },
              "Failed to forward history message",
            )
          },
        )
      }
    } finally {
      session.syncInProgress = false
    }
  }

  async stopAccount(zaloUid: string): Promise<void> {
    const session = this.sessions.get(zaloUid)
    if (!session) {
      return
    }
    session.stopped = true
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
      session.reconnectTimer = null
    }
    if (session.api) {
      try {
        session.api.listener.stop()
      } catch (err) {
        logger.warn({ err, zaloUid }, "Error stopping Zalo listener")
      }
      session.api = null
    }
    await this.cleanupLockOnly(session)
    session.state = "disconnected"
    this.sessions.delete(zaloUid)
    logger.info({ zaloUid }, "Stopped Zalo personal listener")
  }

  async stopAll(): Promise<void> {
    const uids = [...this.sessions.keys()]
    await Promise.all(uids.map((uid) => this.stopAccount(uid)))
  }

  async verifyCredentials(
    credentials: AccountCredentials,
    proxyUrl?: string,
  ): Promise<{ zaloUid: string; displayName: string; avatar?: string }> {
    const effectiveProxy = proxyUrl ?? this.options.defaultProxyUrl
    const zalo = new Zalo({
      selfListen: false,
      checkUpdate: false,
      logging: false,
      ...(effectiveProxy
        ? {
            agent: createProxyAgent(effectiveProxy),
            polyfill: createProxyFetch(effectiveProxy),
          }
        : {}),
    })
    const api = await zalo.login(credentials)
    const zaloUid = api.getOwnId()
    let displayName = zaloUid
    let avatar: string | undefined
    try {
      const info = await api.fetchAccountInfo()
      const profile = (
        info as {
          profile?: { displayName?: string; zaloName?: string; avatar?: string }
        }
      )?.profile
      displayName = profile?.displayName ?? profile?.zaloName ?? zaloUid
      avatar = profile?.avatar
    } catch (err) {
      logger.warn({ err, zaloUid }, "fetchAccountInfo failed during verify")
    }
    return { zaloUid, displayName, avatar }
  }

  async sendMessage(
    input: SendMessageInput,
  ): Promise<{ messageIds: string[] }> {
    const session = this.sessions.get(input.zaloUid)
    if (!session?.api || session.state !== "connected") {
      throw new Error(
        `Zalo personal session for ${input.zaloUid} is not connected`,
      )
    }

    const threadType =
      input.threadType === "group" ? ThreadType.Group : ThreadType.User

    const attachments = await Promise.all(
      (input.attachments ?? []).map(async (att) => {
        const res = await fetch(att.url)
        if (!res.ok) {
          throw new Error(
            `Failed to download attachment (${res.status}) for Zalo send`,
          )
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        const filename = (
          att.filename.includes(".") ? att.filename : `${att.filename}.bin`
        ) as `${string}.${string}`
        return {
          data: buffer,
          filename,
          metadata: { totalSize: buffer.byteLength },
        }
      }),
    )

    const result = await session.api.sendMessage(
      {
        msg: input.text ?? "",
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      input.threadId,
      threadType,
    )

    const messageIds: string[] = []
    if (result.message?.msgId !== undefined) {
      messageIds.push(String(result.message.msgId))
    }
    for (const att of result.attachment ?? []) {
      if (att.msgId !== undefined) {
        messageIds.push(String(att.msgId))
      }
    }
    return { messageIds }
  }

  private async forwardWebhook(
    webhookUrl: string,
    secret: string | undefined,
    payload: NormalizedWebhookPayload,
  ): Promise<void> {
    const body = JSON.stringify(payload)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (secret) {
      headers["X-Zalo-Personal-Signature"] = signWebhookPayload(body, secret)
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body,
      })
      if (!response.ok) {
        logger.warn(
          {
            status: response.status,
            zaloUid: payload.zaloUid,
            threadId: payload.threadId,
          },
          "Builder webhook returned non-OK status",
        )
      }
    } catch (err) {
      logger.error(
        { err, zaloUid: payload.zaloUid, threadId: payload.threadId },
        "Failed to forward Zalo personal webhook to builder",
      )
    }
  }
}

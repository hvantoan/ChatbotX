import { afterEach, describe, expect, test, vi } from "vitest"
import { ThreadType } from "zca-js"
import { RedisListenerLock } from "../src/lock"
import { createGatewayServer } from "../src/server"
import {
  calculateBackoffMs,
  normalizeIncomingMessage,
  normalizeMessage,
  signWebhookPayload,
  ZaloSessionManager,
} from "../src/session-manager"

describe("calculateBackoffMs", () => {
  test("grows exponentially and caps at maxMs", () => {
    const d0 = calculateBackoffMs(0, 1000, 10_000)
    const d1 = calculateBackoffMs(1, 1000, 10_000)
    const d5 = calculateBackoffMs(5, 1000, 10_000)

    expect(d0).toBeGreaterThanOrEqual(1000)
    expect(d0).toBeLessThanOrEqual(1200)
    expect(d1).toBeGreaterThanOrEqual(2000)
    expect(d1).toBeLessThanOrEqual(2400)
    expect(d5).toBeLessThanOrEqual(10_000)
  })
})

describe("signWebhookPayload", () => {
  test("produces deterministic sha256 hex signature", () => {
    const sig1 = signWebhookPayload('{"hello":"world"}', "secret-key-123456")
    const sig2 = signWebhookPayload('{"hello":"world"}', "secret-key-123456")
    const sig3 = signWebhookPayload('{"hello":"other"}', "secret-key-123456")

    expect(sig1).toBe(sig2)
    expect(sig1).not.toBe(sig3)
    expect(sig1).toHaveLength(64)
  })
})

describe("normalizeIncomingMessage", () => {
  test("ignores self messages", () => {
    const result = normalizeIncomingMessage(
      {
        type: ThreadType.User,
        threadId: "123",
        isSelf: true,
        data: {
          msgId: "m1",
          cliMsgId: "c1",
          uidFrom: "own",
          dName: "Me",
          ts: "1700000000000",
          content: "hi",
          msgType: "webchat",
        },
      } as never,
      "own",
      "int-1",
    )
    expect(result).toBeNull()
  })

  test("normalizes 1-1 User message", () => {
    const result = normalizeIncomingMessage(
      {
        type: ThreadType.User,
        threadId: "user-42",
        isSelf: false,
        data: {
          msgId: "m-1",
          cliMsgId: "c-1",
          uidFrom: "user-42",
          dName: "Alice",
          ts: "1700000000000",
          content: "Hello!",
          msgType: "webchat",
        },
      } as never,
      "own-uid",
      "int-1",
    )

    expect(result).toEqual({
      zaloUid: "own-uid",
      integrationId: "int-1",
      threadId: "user-42",
      threadType: "user",
      senderId: "user-42",
      senderName: "Alice",
      messageId: "m-1",
      text: "Hello!",
      attachments: [],
      isMentionedMe: false,
      isSelf: false,
      timestamp: 1_700_000_000_000,
    })
  })

  test("normalizes Group message and detects mention", () => {
    const result = normalizeIncomingMessage(
      {
        type: ThreadType.Group,
        threadId: "group-99",
        isSelf: false,
        data: {
          msgId: "m-2",
          cliMsgId: "c-2",
          uidFrom: "member-7",
          dName: "Bob",
          ts: "1700000001000",
          content: "@Bot help",
          msgType: "webchat",
          mentions: [{ uid: "own-uid", pos: 0, len: 4, type: 0 }],
        },
      } as never,
      "own-uid",
      "int-1",
    )

    expect(result).toMatchObject({
      threadId: "group-99",
      threadType: "group",
      senderId: "member-7",
      senderName: "Bob",
      isMentionedMe: true,
      text: "@Bot help",
    })
  })
})

describe("RedisListenerLock", () => {
  test("acquires, renews, and releases lock", async () => {
    const setMock = vi.fn().mockResolvedValue("OK")
    const evalMock = vi.fn().mockResolvedValue(1)
    const lock = new RedisListenerLock(
      { set: setMock, eval: evalMock } as never,
      30_000,
    )

    const handle = await lock.acquire("uid-1")
    expect(handle).not.toBeNull()
    expect(setMock).toHaveBeenCalledWith(
      "zalo-personal:listener:lock:uid-1",
      expect.any(String),
      "PX",
      30_000,
      "NX",
    )

    const renewed = await handle?.renew()
    expect(renewed).toBe(true)
    await handle?.release()
    expect(evalMock).toHaveBeenCalledTimes(2)
  })

  test("returns null when lock is already held", async () => {
    const setMock = vi.fn().mockResolvedValue(null)
    const lock = new RedisListenerLock({ set: setMock } as never, 30_000)

    const handle = await lock.acquire("uid-1")
    expect(handle).toBeNull()
  })
})

describe("createGatewayServer", () => {
  let server: ReturnType<typeof createGatewayServer> | null = null

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()))
      server = null
    }
  })

  test("enforces bearer auth and routes requests", async () => {
    const token = "a".repeat(32)
    server = createGatewayServer({
      token,
      qrManager: {
        startSession: vi.fn().mockResolvedValue({
          sessionId: "s-1",
          status: "pending",
          qrImageBase64: "data:image/png;base64,abc",
        }),
        getStatus: vi.fn().mockReturnValue({
          sessionId: "s-1",
          status: "pending",
        }),
      },
      sessionManager: {
        getActiveCount: vi.fn().mockReturnValue(1),
        getStatus: vi.fn().mockReturnValue({
          zaloUid: "uid-1",
          state: "connected",
          reconnectAttempts: 0,
        }),
        startAccount: vi.fn().mockResolvedValue({
          zaloUid: "uid-1",
          state: "connected",
        }),
        stopAccount: vi.fn().mockResolvedValue(undefined),
        syncHistory: vi.fn().mockResolvedValue({ ok: true }),
        listFriends: vi
          .fn()
          .mockResolvedValue([{ userId: "f-1", displayName: "Alice" }]),
        verifyCredentials: vi.fn().mockResolvedValue({
          zaloUid: "uid-1",
          displayName: "Zalo User",
        }),
        sendMessage: vi.fn().mockResolvedValue({ messageIds: ["m-10"] }),
      },
    })

    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    )
    const addr = server.address()
    if (!addr || typeof addr === "string") {
      throw new Error("Expected TCP address")
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`

    const healthRes = await fetch(`${baseUrl}/health`)
    expect(healthRes.status).toBe(200)
    expect(await healthRes.json()).toEqual({ ok: true, activeSessions: 1 })

    const unauthRes = await fetch(`${baseUrl}/qr/start`, {
      method: "POST",
      body: "{}",
    })
    expect(unauthRes.status).toBe(401)

    const qrRes = await fetch(`${baseUrl}/qr/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
    expect(qrRes.status).toBe(200)
    expect(await qrRes.json()).toMatchObject({
      sessionId: "s-1",
      status: "pending",
    })

    const sendRes = await fetch(`${baseUrl}/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        zaloUid: "uid-1",
        threadId: "t-1",
        threadType: "group",
        text: "Hello group",
      }),
    })
    expect(sendRes.status).toBe(200)
    expect(await sendRes.json()).toEqual({ messageIds: ["m-10"] })

    const syncRes = await fetch(`${baseUrl}/accounts/uid-1/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    expect(syncRes.status).toBe(200)
    expect(await syncRes.json()).toEqual({ ok: true })

    const friendsRes = await fetch(`${baseUrl}/accounts/uid-1/friends`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(friendsRes.status).toBe(200)
    expect(await friendsRes.json()).toEqual({
      friends: [{ userId: "f-1", displayName: "Alice" }],
    })
  })

  test("answers 409 session_not_connected when the gateway holds no session", async () => {
    const token = "b".repeat(32)
    const manager = new ZaloSessionManager(
      { acquire: vi.fn() } as unknown as RedisListenerLock,
      { maxAccounts: 1 },
    )
    server = createGatewayServer({
      token,
      qrManager: { startSession: vi.fn(), getStatus: vi.fn() },
      sessionManager: manager,
    })
    await new Promise<void>((resolve) =>
      server?.listen(0, "127.0.0.1", resolve),
    )
    const addr = server.address()
    if (!addr || typeof addr === "string") {
      throw new Error("Expected TCP address")
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }

    const statusRes = await fetch(`${baseUrl}/accounts/uid-9/status`, {
      headers,
    })
    expect(await statusRes.json()).toMatchObject({
      zaloUid: "uid-9",
      tracked: false,
      state: "disconnected",
    })

    const sendRes = await fetch(`${baseUrl}/messages/send`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        zaloUid: "uid-9",
        threadId: "t-1",
        threadType: "user",
        text: "hi",
      }),
    })
    expect(sendRes.status).toBe(409)
    expect(await sendRes.json()).toMatchObject({
      code: "session_not_connected",
    })

    const syncRes = await fetch(`${baseUrl}/accounts/uid-9/sync`, {
      method: "POST",
      headers,
    })
    expect(syncRes.status).toBe(409)

    const friendsRes = await fetch(`${baseUrl}/accounts/uid-9/friends`, {
      headers,
    })
    expect(friendsRes.status).toBe(409)
  })
})

describe("normalizeMessage (history sync)", () => {
  test("preserves self messages and metadata when allowSelf and isHistorySync are set", () => {
    const result = normalizeMessage(
      {
        type: ThreadType.User,
        threadId: "user-42",
        isSelf: true,
        data: {
          msgId: "m-hist-1",
          cliMsgId: "c-hist-1",
          uidFrom: "own-uid",
          dName: "Me",
          ts: "1700000000000",
          content: "Previous reply",
          msgType: "webchat",
        },
      } as never,
      "own-uid",
      "int-1",
      {
        allowSelf: true,
        isHistorySync: true,
        threadName: "Alice",
        threadAvatar: "https://example.com/avatar.jpg",
      },
    )

    expect(result).toEqual({
      zaloUid: "own-uid",
      integrationId: "int-1",
      threadId: "user-42",
      threadType: "user",
      senderId: "own-uid",
      senderName: "Me",
      messageId: "m-hist-1",
      text: "Previous reply",
      attachments: [],
      isMentionedMe: false,
      isSelf: true,
      timestamp: 1_700_000_000_000,
      isHistorySync: true,
      threadName: "Alice",
      threadAvatar: "https://example.com/avatar.jpg",
    })
  })
})

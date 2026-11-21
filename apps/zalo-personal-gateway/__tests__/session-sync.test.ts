import { afterEach, describe, expect, test, vi } from "vitest"

const listenerHandlers = new Map<string, (...args: unknown[]) => void>()
const requestOldMessages = vi.fn()

vi.mock("zca-js", () => {
  class MockListener {
    on(event: string, cb: (...args: unknown[]) => void) {
      listenerHandlers.set(event, cb)
    }
    start() {
      // Deliberately does not emit `connected`: the socket is CONNECTING
      // until the test fires the event explicitly.
    }
    stop() {
      // No-op: no real socket is opened.
    }
    requestOldMessages(...args: unknown[]) {
      requestOldMessages(...args)
    }
  }
  const api = {
    listener: new MockListener(),
    getOwnId: () => "own-uid",
  }
  class Zalo {
    login(_credentials: unknown) {
      return Promise.resolve(api)
    }
  }
  return {
    Zalo,
    ThreadType: { User: 0, Group: 1 },
    CloseReason: { DuplicateConnection: 1, KickConnection: 2 },
  }
})

import { RedisListenerLock } from "../src/lock"
import { ZaloSessionManager } from "../src/session-manager"

const buildManager = () => {
  const lock = new RedisListenerLock(
    {
      set: vi.fn().mockResolvedValue("OK"),
      eval: vi.fn().mockResolvedValue(1),
    } as never,
    30_000,
  )
  return new ZaloSessionManager(lock, { maxAccounts: 5 })
}

const startInput = {
  integrationId: "int-1",
  zaloUid: "uid-1",
  credentials: {
    imei: "imei-1",
    cookie: [],
    userAgent: "ua",
  },
  webhookUrl: "http://localhost:1/webhook",
}

describe("ZaloSessionManager initial history sync", () => {
  let manager: ZaloSessionManager | null = null

  afterEach(async () => {
    if (manager) {
      await manager.stopAccount("uid-1")
      manager = null
    }
    listenerHandlers.clear()
    requestOldMessages.mockClear()
  })

  test("does not request old messages before the listener `connected` event", async () => {
    manager = buildManager()
    const result = await manager.startAccount(startInput)

    // `listener.start()` returns while the socket is still CONNECTING: the
    // sync must not have fired yet, or `ws.send` would throw mid-handshake.
    expect(result.state).toBe("connected")
    expect(requestOldMessages).not.toHaveBeenCalled()

    listenerHandlers.get("connected")?.()
    await vi.waitFor(() => {
      expect(requestOldMessages).toHaveBeenCalledTimes(2)
    })
  })

  test("initial sync runs at most once across reconnects of the same session", async () => {
    manager = buildManager()
    await manager.startAccount(startInput)

    listenerHandlers.get("connected")?.()
    await vi.waitFor(() => {
      expect(requestOldMessages).toHaveBeenCalledTimes(2)
    })

    listenerHandlers.get("connected")?.()
    expect(requestOldMessages).toHaveBeenCalledTimes(2)
  })
})

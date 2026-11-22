import { describe, expect, test, vi } from "vitest"
import type { RedisListenerLock } from "../src/lock"
import {
  type StartAccountInput,
  ZaloSessionManager,
} from "../src/session-manager"

// The restore cron and a user reconnect can call `/accounts/start` for the
// same account at the same time. A second call used to stop the session
// mid-login and start another one, which kicked the first login out of Zalo.
// It must join the login already running instead.

const input: StartAccountInput = {
  integrationId: "int-1",
  zaloUid: "uid-1",
  credentials: { imei: "imei", cookie: [], userAgent: "ua" },
  webhookUrl: "http://localhost/webhook",
  webhookSecret: "s".repeat(48),
}

type ConnectSession = (session: unknown) => Promise<void>
// `ManagedSession` is private; the stub only flips its state.
type MutableSession = { state: string }

const connectSpy = (manager: ZaloSessionManager) =>
  vi.spyOn(
    manager as unknown as { connectSession: ConnectSession },
    "connectSession",
  )

const markConnected = (session: unknown) => {
  const mutable = session as MutableSession
  mutable.state = "connected"
}

describe("startAccount concurrency", () => {
  test("joins the in-flight login instead of stopping and restarting it", async () => {
    const manager = new ZaloSessionManager({} as RedisListenerLock, {
      maxAccounts: 5,
    })
    const connect = connectSpy(manager)
    const stop = vi.spyOn(manager, "stopAccount")

    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    connect.mockImplementation(async (session) => {
      await gate
      markConnected(session)
    })

    const first = manager.startAccount(input)
    const second = manager.startAccount(input)
    release()

    const [a, b] = await Promise.all([first, second])

    expect(connect).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()
    expect(a).toEqual({ zaloUid: "uid-1", state: "connected" })
    expect(b).toEqual({ zaloUid: "uid-1", state: "connected" })
  })

  test("reuses a connected session without logging in again", async () => {
    const manager = new ZaloSessionManager({} as RedisListenerLock, {
      maxAccounts: 5,
    })
    const connect = connectSpy(manager)
    connect.mockImplementation((session) => {
      markConnected(session)
      return Promise.resolve()
    })

    await manager.startAccount(input)
    await manager.startAccount(input)

    expect(connect).toHaveBeenCalledTimes(1)
  })
})

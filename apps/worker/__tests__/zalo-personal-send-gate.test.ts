import { ChatJobAction } from "@inboxos.io/worker-config"
import { DelayedError } from "bullmq"
import { beforeEach, describe, expect, test, vi } from "vitest"

const findByZaloUid = vi.fn()
const getAccountStatus = vi.fn()
const ensureZaloPersonalSession = vi.fn()

vi.mock("@inboxos.io/business", () => ({
  integrationZaloPersonalService: {
    findByZaloUid: (zaloUid: string) => findByZaloUid(zaloUid),
  },
}))

vi.mock("@inboxos.io/integration-zalo-personal", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@inboxos.io/integration-zalo-personal")
    >()
  return {
    ...actual,
    gatewayClient: {
      getAccountStatus: (zaloUid: string) => getAccountStatus(zaloUid),
    },
  }
})

vi.mock("../src/lib/zalo-personal-session", () => ({
  ensureZaloPersonalSession: (account: unknown) =>
    ensureZaloPersonalSession(account),
}))

vi.mock("../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { ZaloPersonalAPIException } = await import(
  "@inboxos.io/integration-zalo-personal"
)
const { deferSendWhileZaloPersonalReconnects } = await import(
  "../src/chat/utils/zalo-personal-send-gate"
)

const sessionNotConnected = () =>
  new ZaloPersonalAPIException("not connected", 409)

const job = (overrides: Record<string, unknown> = {}) => {
  const moveToDelayed = vi.fn().mockResolvedValue(undefined)
  return {
    moveToDelayed,
    job: {
      id: "job-1",
      data: {
        type: ChatJobAction.sendChannelMessage,
        data: {
          contactInbox: { channel: "zalo_personal", sourceId: "uid-1" },
        },
      },
      attemptsStarted: 1,
      attemptsMade: 0,
      moveToDelayed,
      ...overrides,
    },
  }
}

const account = { id: "int-1", workspaceId: "ws-1", zaloUid: "uid-1" }

describe("deferSendWhileZaloPersonalReconnects", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureZaloPersonalSession.mockResolvedValue("restored")
  })

  test("restores an untracked session and parks the job", async () => {
    findByZaloUid.mockResolvedValue(account)
    getAccountStatus.mockResolvedValue({
      tracked: false,
      state: "disconnected",
      reconnectAttempts: 0,
    })
    const { job: j, moveToDelayed } = job()

    await expect(
      deferSendWhileZaloPersonalReconnects(
        j as never,
        "token",
        sessionNotConnected(),
      ),
    ).rejects.toBeInstanceOf(DelayedError)

    expect(ensureZaloPersonalSession).toHaveBeenCalledWith(account)
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "token")
  })

  test("backs off 5s, 10s, 20s, 40s and stops at the budget", async () => {
    findByZaloUid.mockResolvedValue(account)
    getAccountStatus.mockResolvedValue({
      tracked: true,
      state: "connecting",
      reconnectAttempts: 0,
    })

    for (const [deferral, delayMs] of [
      5000, 10_000, 20_000, 40_000,
    ].entries()) {
      const { job: j, moveToDelayed } = job({ attemptsStarted: deferral + 1 })
      await expect(
        deferSendWhileZaloPersonalReconnects(
          j as never,
          "token",
          sessionNotConnected(),
        ),
      ).rejects.toBeInstanceOf(DelayedError)
      expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "token")
      const [at] = moveToDelayed.mock.calls[0] as [number]
      expect(at - Date.now()).toBeGreaterThan(delayMs - 1000)
    }

    const { job: spent, moveToDelayed } = job({ attemptsStarted: 6 })
    await expect(
      deferSendWhileZaloPersonalReconnects(
        spent as never,
        "token",
        sessionNotConnected(),
      ),
    ).resolves.toBeUndefined()
    expect(moveToDelayed).not.toHaveBeenCalled()
    expect(ensureZaloPersonalSession).not.toHaveBeenCalled()
  })

  test("does not defer a session that needs a human", async () => {
    findByZaloUid.mockResolvedValue(account)
    getAccountStatus.mockResolvedValue({
      tracked: true,
      state: "error",
      reconnectAttempts: 3,
      lastError: "kicked",
    })
    const { job: j, moveToDelayed } = job()

    await expect(
      deferSendWhileZaloPersonalReconnects(
        j as never,
        "token",
        sessionNotConnected(),
      ),
    ).resolves.toBeUndefined()

    expect(moveToDelayed).not.toHaveBeenCalled()
    expect(ensureZaloPersonalSession).not.toHaveBeenCalled()
  })

  test("ignores other errors, channels and missing tokens", async () => {
    const { job: j, moveToDelayed } = job()

    await deferSendWhileZaloPersonalReconnects(
      j as never,
      "token",
      new Error("boom"),
    )
    await deferSendWhileZaloPersonalReconnects(
      j as never,
      "token",
      new ZaloPersonalAPIException("gateway down", 500),
    )
    await deferSendWhileZaloPersonalReconnects(
      j as never,
      undefined,
      sessionNotConnected(),
    )

    const otherChannel = job({
      data: {
        type: ChatJobAction.sendChannelMessage,
        data: { contactInbox: { channel: "messenger", sourceId: "psid" } },
      },
    })
    await deferSendWhileZaloPersonalReconnects(
      otherChannel.job as never,
      "token",
      sessionNotConnected(),
    )

    expect(findByZaloUid).not.toHaveBeenCalled()
    expect(moveToDelayed).not.toHaveBeenCalled()
    expect(otherChannel.moveToDelayed).not.toHaveBeenCalled()
  })

  test("fails normally when the account row is gone", async () => {
    findByZaloUid.mockResolvedValue(null)
    const { job: j, moveToDelayed } = job()

    await expect(
      deferSendWhileZaloPersonalReconnects(
        j as never,
        "token",
        sessionNotConnected(),
      ),
    ).resolves.toBeUndefined()

    expect(moveToDelayed).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, test, vi } from "vitest"

// The gateway keeps Zalo Personal sessions in memory only. The restore cron
// must start a session for every account the gateway does not track, leave
// tracked sessions (even errored ones) alone, skip accounts it cannot start
// safely, and keep going when one account fails.

const listForSessionRestore = vi.fn()
const getDecryptedCredentials = vi.fn()
const getAccountStatus = vi.fn()
const startAccount = vi.fn()

vi.mock("@inboxos.io/business", () => ({
  integrationZaloPersonalService: {
    listForSessionRestore: () => listForSessionRestore(),
    getDecryptedCredentials: (input: unknown) => getDecryptedCredentials(input),
  },
}))

vi.mock("@inboxos.io/integration-zalo-personal", () => ({
  buildZaloPersonalWebhookUrl: (origin: string, zaloUid: string) =>
    `${origin}/integrations/zalo_personal/webhook?zaloUid=${zaloUid}`,
  gatewayClient: {
    getAccountStatus: (zaloUid: string) => getAccountStatus(zaloUid),
    startAccount: (input: unknown) => startAccount(input),
  },
}))

vi.mock("@inboxos.io/redis", () => ({
  distributedLock: {
    runExclusive: ({ fn }: { fn: () => Promise<unknown> }) => fn(),
  },
}))

vi.mock("../src/env", () => ({
  env: {
    NEXT_PUBLIC_BROKER_URL: "http://broker.test:3123/ignored-path",
    NEXT_PUBLIC_BUILDER_URL: "http://builder.test",
  },
}))

vi.mock("../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { restoreZaloPersonalSessions } = await import(
  "../src/schedule/handlers/restore-zalo-personal-sessions"
)

const credentials = { imei: "imei", cookie: [], userAgent: "ua" }

describe("restoreZaloPersonalSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startAccount.mockResolvedValue({ state: "connected" })
  })

  test("does nothing when no account is connected", async () => {
    listForSessionRestore.mockResolvedValue([])

    await expect(restoreZaloPersonalSessions()).resolves.toEqual({
      running: 0,
      restored: 0,
      skipped: 0,
      failed: 0,
    })
    expect(getAccountStatus).not.toHaveBeenCalled()
  })

  test("starts only untracked sessions, with the broker-origin webhook URL", async () => {
    listForSessionRestore.mockResolvedValue([
      { id: "i-lost", workspaceId: "w-1", zaloUid: "u-lost" },
      { id: "i-live", workspaceId: "w-1", zaloUid: "u-live" },
      { id: "i-err", workspaceId: "w-2", zaloUid: "u-err" },
      { id: "i-old", workspaceId: "w-2", zaloUid: "u-old" },
    ])
    getAccountStatus.mockImplementation((zaloUid: string) => {
      switch (zaloUid) {
        case "u-lost":
          return { tracked: false, state: "disconnected" }
        case "u-err":
          return { tracked: true, state: "error" }
        case "u-old":
          // A gateway predating `tracked` — never guess, leave it alone.
          return { state: "disconnected" }
        default:
          return { tracked: true, state: "connected" }
      }
    })
    getDecryptedCredentials.mockResolvedValue({
      zaloUid: "u-lost",
      proxyUrl: "http://proxy.test:8080",
      webhookSecret: "s".repeat(48),
      credentials,
    })

    const counts = await restoreZaloPersonalSessions()

    expect(counts).toEqual({ running: 3, restored: 1, skipped: 0, failed: 0 })
    expect(getDecryptedCredentials).toHaveBeenCalledTimes(1)
    expect(getDecryptedCredentials).toHaveBeenCalledWith({
      id: "i-lost",
      workspaceId: "w-1",
    })
    expect(startAccount).toHaveBeenCalledWith({
      integrationId: "i-lost",
      zaloUid: "u-lost",
      credentials,
      webhookUrl:
        "http://broker.test:3123/integrations/zalo_personal/webhook?zaloUid=u-lost",
      webhookSecret: "s".repeat(48),
      proxyUrl: "http://proxy.test:8080",
    })
  })

  test("skips accounts without a webhook secret and continues past failures", async () => {
    listForSessionRestore.mockResolvedValue([
      { id: "i-nosecret", workspaceId: "w-1", zaloUid: "u-nosecret" },
      { id: "i-down", workspaceId: "w-1", zaloUid: "u-down" },
      { id: "i-ok", workspaceId: "w-1", zaloUid: "u-ok" },
    ])
    getAccountStatus.mockImplementation((zaloUid: string) => {
      if (zaloUid === "u-down") {
        return Promise.reject(new Error("gateway unreachable"))
      }
      return { tracked: false, state: "disconnected" }
    })
    getDecryptedCredentials.mockImplementation(({ id }: { id: string }) =>
      id === "i-nosecret"
        ? { proxyUrl: null, webhookSecret: null, credentials }
        : { proxyUrl: null, webhookSecret: "x".repeat(48), credentials },
    )

    const counts = await restoreZaloPersonalSessions()

    expect(counts).toEqual({ running: 0, restored: 1, skipped: 1, failed: 1 })
    expect(startAccount).toHaveBeenCalledTimes(1)
    expect(startAccount.mock.calls[0]?.[0]).toMatchObject({
      integrationId: "i-ok",
    })
    expect(startAccount.mock.calls[0]?.[0]).not.toHaveProperty("proxyUrl")
  })
})

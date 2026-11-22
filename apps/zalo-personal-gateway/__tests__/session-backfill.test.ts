import { afterEach, describe, expect, type Mock, test, vi } from "vitest"

const listenerHandlers = new Map<string, (...args: unknown[]) => void>()
const mocks = vi.hoisted(() => ({
  getAllGroups: vi.fn(),
  getAllFriends: vi.fn(),
  getCloudMessage: vi.fn(),
  getGroupInfo: vi.fn(),
}))

vi.mock("zca-js", () => {
  class MockListener {
    on(event: string, cb: (...args: unknown[]) => void) {
      listenerHandlers.set(event, cb)
    }
    start() {
      // No-op: no real socket is opened.
    }
    stop() {
      // No-op.
    }
    requestOldMessages() {
      // No-op.
    }
  }
  const api = {
    listener: new MockListener(),
    getOwnId: () => "own-uid",
    getAllGroups: mocks.getAllGroups,
    getAllFriends: mocks.getAllFriends,
    getCloudMessage: mocks.getCloudMessage,
    getGroupInfo: mocks.getGroupInfo,
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
  credentials: { imei: "imei-1", cookie: [], userAgent: "ua" },
  webhookUrl: "http://localhost:1/webhook",
  webhookSecret: "secret-secret-secret",
}

const groupMessage = (id: string) => ({
  type: 1, // ThreadType.Group
  threadId: "g-1",
  isSelf: false,
  data: {
    msgId: id,
    cliMsgId: id,
    ts: "1700000000000",
    uidFrom: "u-2",
    dName: "Bob",
    content: `hello ${id}`,
    msgType: "webchat",
  },
})

const page = (ids: string[], lastMsgId: string, hasMore: number) => ({
  error: 0,
  groupMsgs: ids.map(groupMessage),
  lastMsgId,
  hasMore,
  isOld: 0,
  isFiltered: 0,
})

const bodyOf = (init: unknown): string => {
  if (
    init &&
    typeof init === "object" &&
    "body" in init &&
    typeof init.body === "string"
  ) {
    return init.body
  }
  throw new Error("expected fetch call with a string body")
}

describe("ZaloSessionManager manual group history backfill", () => {
  let manager: ZaloSessionManager | null = null
  let fetchMock: Mock

  afterEach(async () => {
    if (manager) {
      await manager.stopAccount("uid-1")
      manager = null
    }
    listenerHandlers.clear()
    vi.unstubAllGlobals()
    for (const mock of Object.values(mocks)) {
      mock.mockReset()
    }
  })

  const setup = () => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    mocks.getGroupInfo.mockResolvedValue({
      gridInfoMap: { "g-1": { name: "Team", avt: "http://a" } },
    })
    mocks.getAllGroups.mockResolvedValue({
      version: "1",
      gridVerMap: { "g-1": "1" },
    })
    manager = buildManager()
  }

  test("returns immediately and forwards paginated history as group history sync", async () => {
    setup()
    mocks.getCloudMessage
      .mockResolvedValueOnce(page(["m1", "m2"], "m2", 1))
      .mockResolvedValueOnce(page(["m3"], "m3", 0))

    await manager?.startAccount(startInput)
    const result = await manager?.syncHistory("uid-1")

    expect(result).toEqual({ ok: true })
    await vi.waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledTimes(3)
      },
      { timeout: 4000 },
    )

    expect(mocks.getCloudMessage).toHaveBeenCalledTimes(2)
    expect(mocks.getCloudMessage.mock.calls[1]?.slice(0, 3)).toEqual([
      "g-1",
      "m2",
      { isOld: 0 },
    ])

    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("http://localhost:1/webhook")
      const payload = JSON.parse(bodyOf(init))
      expect(payload.threadType).toBe("group")
      expect(payload.isHistorySync).toBe(true)
      expect(payload.threadName).toBe("Team")
    }
    expect(
      fetchMock.mock.calls.map(
        ([, init]) => JSON.parse(bodyOf(init)).messageId as string,
      ),
    ).toEqual(["m1", "m2", "m3"])
  })

  test("stops at the 200 message cap even when Zalo keeps reporting more", async () => {
    setup()
    let counter = 0
    mocks.getCloudMessage.mockImplementation(() => {
      counter += 1
      const ids = Array.from({ length: 50 }, (_, i) => `m${counter}-${i}`)
      return Promise.resolve(page(ids, `cursor-${counter}`, 1))
    })

    await manager?.startAccount(startInput)
    await manager?.syncHistory("uid-1")

    await vi.waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledTimes(200)
      },
      { timeout: 8000 },
    )
    expect(mocks.getCloudMessage).toHaveBeenCalledTimes(4)
  })
})

describe("ZaloSessionManager.listFriends", () => {
  afterEach(() => {
    mocks.getAllFriends.mockReset()
  })

  test("rejects when the account has no session", async () => {
    await expect(buildManager().listFriends("nobody")).rejects.toThrow(
      "not connected",
    )
  })

  test("maps every friend, falling back from display name to Zalo name to id", async () => {
    mocks.getAllFriends.mockResolvedValue([
      {
        userId: "f-1",
        displayName: "Alice",
        zaloName: "alice.z",
        avatar: "http://a",
        phoneNumber: "84900000001",
      },
      { userId: "f-2", displayName: "", zaloName: "bob.z", avatar: "" },
      { userId: "f-3", displayName: "", zaloName: "", avatar: "" },
      { userId: "", displayName: "ghost", zaloName: "", avatar: "" },
    ])
    const manager = buildManager()
    await manager.startAccount(startInput)

    await expect(manager.listFriends("uid-1")).resolves.toEqual([
      {
        userId: "f-1",
        displayName: "Alice",
        avatar: "http://a",
        phoneNumber: "84900000001",
      },
      { userId: "f-2", displayName: "bob.z" },
      { userId: "f-3", displayName: "f-3" },
    ])
    await manager.stopAccount("uid-1")
  })
})

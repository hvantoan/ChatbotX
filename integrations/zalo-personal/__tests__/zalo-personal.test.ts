import { createHmac } from "node:crypto"
import { stepTypes } from "@chatbotx.io/flow-config"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  receiveMessage,
  toContactSourceId,
} from "../src/handlers/message/incoming-message"
import {
  resolveTargetThread,
  sendFlowStep,
  sendMessage,
} from "../src/handlers/message/outgoing-message"
import {
  shouldProcessGroupMessage,
  webhookHandler,
} from "../src/handlers/webhook"
import { gatewayClient } from "../src/lib/gateway-client"
import type { ZaloPersonalWebhookPayload } from "../src/schema"

const basePayload: ZaloPersonalWebhookPayload = {
  zaloUid: "99999",
  integrationId: "int-1",
  threadId: "thread-1",
  threadType: "user",
  senderId: "sender-1",
  senderName: "Alice",
  messageId: "msg-1",
  text: "Xin chao",
  attachments: [],
  isMentionedMe: false,
  isSelf: false,
  timestamp: 1_700_000_000_000,
}

describe("shouldProcessGroupMessage", () => {
  test("always allows 1-1 user messages", () => {
    expect(shouldProcessGroupMessage(basePayload, { mode: "disabled" })).toBe(
      true,
    )
  })

  test("enforces group reply modes", () => {
    const groupPayload: ZaloPersonalWebhookPayload = {
      ...basePayload,
      threadType: "group",
      threadId: "grp-1",
      isMentionedMe: false,
    }
    expect(shouldProcessGroupMessage(groupPayload, { mode: "all" })).toBe(true)
    expect(shouldProcessGroupMessage(groupPayload, { mode: "disabled" })).toBe(
      false,
    )
    expect(shouldProcessGroupMessage(groupPayload, { mode: "mentions" })).toBe(
      false,
    )
    expect(
      shouldProcessGroupMessage(
        { ...groupPayload, isMentionedMe: true },
        { mode: "mentions" },
      ),
    ).toBe(true)
    expect(
      shouldProcessGroupMessage(groupPayload, {
        mode: "allowlist",
        allowedGroupIds: ["grp-2"],
      }),
    ).toBe(false)
    expect(
      shouldProcessGroupMessage(groupPayload, {
        mode: "allowlist",
        allowedGroupIds: ["grp-1"],
      }),
    ).toBe(true)
  })
})

describe("webhookHandler", () => {
  test("verifies HMAC signature and queues incomingMessage", async () => {
    const secret = "test-webhook-secret-123456"
    const body = JSON.stringify(basePayload)
    const sig = createHmac("sha256", secret).update(body).digest("hex")
    const addMock = vi.fn().mockResolvedValue(undefined)

    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "X-Zalo-Personal-Signature": sig },
      body,
    })

    const result = await webhookHandler({
      req,
      config: {
        zaloUid: "99999",
        webhookSecret: secret,
      },
      queue: { add: addMock } as never,
    })

    expect(result).toBe("ok")
    expect(addMock).toHaveBeenCalledWith("incomingMessage", {
      type: "incomingMessage",
      data: {
        integrationType: "zalo_personal",
        integrationIdentifier: "99999",
        payload: basePayload,
      },
    })
  })

  test("rejects invalid signature", async () => {
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "X-Zalo-Personal-Signature": "bad-sig" },
      body: JSON.stringify(basePayload),
    })

    await expect(
      webhookHandler({
        req,
        config: {
          zaloUid: "99999",
          webhookSecret: "test-webhook-secret-123456",
        },
      }),
    ).rejects.toThrow("Invalid webhook signature")
  })
})

describe("receiveMessage and resolveTargetThread", () => {
  test("maps 1-1 and group threadIds cleanly", async () => {
    expect(toContactSourceId("user", "u-1")).toBe("u-1")
    expect(toContactSourceId("group", "g-1")).toBe("group:g-1")
    expect(resolveTargetThread("u-1")).toEqual({
      threadId: "u-1",
      threadType: "user",
    })
    expect(resolveTargetThread("group:g-1")).toEqual({
      threadId: "g-1",
      threadType: "group",
    })

    const groupReceived = await receiveMessage({
      ctx: { auth: { authType: "custom", zaloUid: "99999" } } as never,
      data: {
        integrationType: "zalo_personal",
        integrationIdentifier: "99999",
        payload: {
          ...basePayload,
          threadType: "group",
          threadId: "g-1",
        },
      },
    })

    expect(groupReceived.contact.sourceId).toBe("group:g-1")
    expect(groupReceived.message.text).toBe("[Alice] Xin chao")
  })
})

describe("outgoing-message", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("sends message and flow step via gatewayClient", async () => {
    const sendSpy = vi
      .spyOn(gatewayClient, "sendMessage")
      .mockResolvedValue({ messageIds: ["m-1"] })

    const res = await sendMessage({
      ctx: { auth: { authType: "custom", zaloUid: "99999" } } as never,
      data: {
        contact: { sourceId: "group:g-1" } as never,
        message: { contentType: "text", text: "Hello group" } as never,
      },
    } as never)

    expect(res).toEqual({ messageIds: ["m-1"], sentCount: 1 })
    expect(sendSpy).toHaveBeenCalledWith({
      zaloUid: "99999",
      threadId: "g-1",
      threadType: "group",
      text: "Hello group",
    })

    await sendFlowStep({
      ctx: { auth: { authType: "custom", zaloUid: "99999" } } as never,
      data: {
        contact: { sourceId: "u-1" } as never,
        step: {
          id: "s-1",
          stepType: stepTypes.enum.sendText,
          text: "Hi user",
        } as never,
      },
    } as never)

    expect(sendSpy).toHaveBeenCalledWith({
      zaloUid: "99999",
      threadId: "u-1",
      threadType: "user",
      text: "Hi user",
    })
  })
})

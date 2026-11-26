import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveAgent: vi.fn(),
  completeTurn: vi.fn(),
  listGroups: vi.fn(),
  generateText: vi.fn(),
  createReplyModel: vi.fn(),
  getMasterAgentTools: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  MASTER_AGENT_DEFAULT_PROMPT: "default prompt",
  masterAgentService: {
    getSession: mocks.getSession,
    resolveAgent: mocks.resolveAgent,
    completeTurn: mocks.completeTurn,
    listGroups: mocks.listGroups,
  },
}))

vi.mock("@inboxos.io/ai", () => ({
  aiTimeouts: { aiTotal: 60_000 },
}))

vi.mock("@inboxos.io/ai/master-agent-tools", () => ({
  getMasterAgentTools: mocks.getMasterAgentTools,
}))

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  isStepCount: (count: number) => ({ __stepCount: count }),
}))

vi.mock("../src/lib/ai/reply-model", () => ({
  createReplyModel: mocks.createReplyModel,
  getProviderName: () => "openai",
}))

vi.mock("../src/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { processMasterAgent } = await import(
  "../src/ai-agent/handlers/process-master-agent"
)

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "u-1",
  role: "user",
  content: "Tóm tắt Zoom: nhóm K5, nhắc 20:00 ngày 27/11",
  status: "completed",
  broadcastId: null,
  createdAt: new Date("2026-11-26T10:00:00.000Z"),
  ...overrides,
})

const data = { workspaceId: "ws-1", sessionId: "s-1", messageId: "a-1" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveAgent.mockResolvedValue({
    id: "agent-1",
    prompt: "custom prompt",
    models: [{ provider: "openai", model: "gpt-x" }],
  })
  mocks.createReplyModel.mockResolvedValue({ model: "model-instance" })
  mocks.getMasterAgentTools.mockReturnValue({
    listGroups: { execute: mocks.listGroups },
  })
  mocks.getSession.mockResolvedValue({
    sessionId: "s-1",
    status: "pending",
    messages: [
      message(),
      message({ id: "a-1", role: "assistant", content: "" }),
    ],
    drafts: [],
  })
})

describe("processMasterAgent", () => {
  test("answers from the stored history and writes the reply into the pending turn", async () => {
    mocks.generateText.mockResolvedValue({
      text: "  Đã soạn nháp nhắc lịch K5 lúc 20:00 ngày 27/11.  ",
    })

    await processMasterAgent(data)

    const call = mocks.generateText.mock.calls[0]?.[0]
    expect(call.instructions).toContain("custom prompt")
    // The pending assistant row is not replayed into the prompt.
    expect(call.messages).toEqual([
      { role: "user", content: "Tóm tắt Zoom: nhóm K5, nhắc 20:00 ngày 27/11" },
    ])
    expect(call.tools).toBeDefined()
    expect(mocks.completeTurn).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      messageId: "a-1",
      content: "Đã soạn nháp nhắc lịch K5 lúc 20:00 ngày 27/11.",
      status: "completed",
    })
  })

  test("a follow-up queued behind the turn is not answered by it", async () => {
    mocks.getSession.mockResolvedValue({
      sessionId: "s-1",
      status: "pending",
      messages: [
        message(),
        message({ id: "a-1", role: "assistant", content: "" }),
        message({ id: "u-2", content: "Tóm tắt Zoom: nhóm K3" }),
      ],
      drafts: [],
    })
    mocks.generateText.mockResolvedValue({ text: "ok" })

    await processMasterAgent(data)

    expect(mocks.generateText.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "Tóm tắt Zoom: nhóm K5, nhắc 20:00 ngày 27/11" },
    ])
  })

  test("treats the operator-initiated turn as independent of AI Auto Reply", async () => {
    mocks.generateText.mockResolvedValue({ text: "ok" })

    await processMasterAgent(data)

    expect(mocks.createReplyModel).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", requireAutoReply: false }),
    )
  })

  test("a tool the model calls runs through the shared service", async () => {
    mocks.generateText.mockImplementation(async (options) => {
      await options.tools.listGroups.execute({})
      return { text: "ok" }
    })

    await processMasterAgent(data)

    expect(mocks.listGroups).toHaveBeenCalled()
  })

  test("a workspace without a non-default agent fails the turn without calling a model", async () => {
    mocks.resolveAgent.mockResolvedValue(null)

    await processMasterAgent(data)

    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(mocks.completeTurn).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      messageId: "a-1",
      content: "",
      status: "failed",
    })
  })

  test("every provider failing marks the turn failed without retrying the job", async () => {
    mocks.generateText.mockRejectedValue(new Error("provider down"))

    await processMasterAgent(data)

    expect(mocks.completeTurn).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      messageId: "a-1",
      content: "",
      status: "failed",
    })
  })

  test("an unexpected failure marks the turn failed and rethrows for a retry", async () => {
    mocks.getSession.mockRejectedValue(new Error("db down"))

    await expect(processMasterAgent(data)).rejects.toThrow("db down")

    expect(mocks.completeTurn).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      messageId: "a-1",
      content: "",
      status: "failed",
    })
  })
})

import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getConfig: vi.fn(),
  completeTurn: vi.fn(),
  createPendingAction: vi.fn(),
  generateText: vi.fn(),
  createReplyModel: vi.fn(),
  executeOperation: vi.fn(),
  prepareToolExecution: vi.fn(),
  findCurrentStateTool: vi.fn(),
  loadMasterAgentCatalog: vi.fn(),
  findCatalogToolByName: vi.fn(),
  getMasterAgentCatalogTools: vi.fn(),
  mintMasterAgentCredential: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  MASTER_AGENT_DEFAULT_PROMPT: "default prompt",
  MASTER_AGENT_TIMEZONE: "Asia/Saigon",
  masterAgentService: {
    getSession: mocks.getSession,
    getConfig: mocks.getConfig,
    completeTurn: mocks.completeTurn,
    createPendingAction: mocks.createPendingAction,
  },
  mintMasterAgentCredential: mocks.mintMasterAgentCredential,
}))

vi.mock("@inboxos.io/openapi-catalog", async () => {
  const actual = await vi.importActual<
    typeof import("@inboxos.io/openapi-catalog")
  >("@inboxos.io/openapi-catalog")
  return {
    ...actual,
    executeOperation: mocks.executeOperation,
    prepareToolExecution: mocks.prepareToolExecution,
    findCurrentStateTool: mocks.findCurrentStateTool,
  }
})

vi.mock("../src/lib/master-agent/catalog", () => ({
  loadMasterAgentCatalog: mocks.loadMasterAgentCatalog,
  findCatalogToolByName: mocks.findCatalogToolByName,
  getMasterAgentCatalogTools: mocks.getMasterAgentCatalogTools,
}))

vi.mock("@inboxos.io/ai", () => ({
  aiTimeouts: { aiTotal: 60_000 },
}))

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  isStepCount: (count: number) => ({ __stepCount: count }),
  tool: (definition: unknown) => definition,
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
const { runCatalogTool } = await import("../src/lib/master-agent/run")

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "u-1",
  role: "user",
  content: "Tóm tắt Zoom: nhóm K5, nhắc 20:00 ngày 27/11",
  status: "completed",
  createdAt: new Date("2026-11-26T10:00:00.000Z"),
  ...overrides,
})

const data = {
  workspaceId: "ws-1",
  sessionId: "s-1",
  messageId: "a-1",
  memberId: "m-1",
  tokenId: null,
}

const toolFixture = (overrides: Record<string, unknown> = {}) => ({
  name: "broadcasts_schedule",
  operationId: "broadcasts.schedule",
  method: "POST",
  baseUrl: "https://api.example.com",
  pathTemplate: "/v1/broadcasts/{id}/schedule",
  pathParamNames: ["id"],
  queryParamNames: [],
  bodyParamNames: ["schedulesType", "schedulesAt"],
  hitlPolicy: "confirm_outbound",
  inputSchema: { type: "object", properties: {}, required: [] },
  annotations: {
    destructiveHint: false,
    idempotentHint: false,
    readOnlyHint: false,
    openWorldHint: true,
    title: "Schedule broadcast",
  },
  alwaysVisible: false,
  description: "Schedule broadcast",
  tags: ["Broadcasts"],
  visibility: "default",
  ...overrides,
})

const turnContext = {
  workspaceId: "ws-1",
  sessionId: "s-1",
  messageId: "a-1",
  memberId: "m-1",
  tokenId: null,
  autoApproveDiff: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getConfig.mockResolvedValue({
    enabled: true,
    autoApproveDiff: false,
    prompt: "custom prompt",
    models: [{ provider: "openai", model: "gpt-x" }],
  })
  mocks.createReplyModel.mockResolvedValue({ model: "model-instance" })
  mocks.getSession.mockResolvedValue({
    sessionId: "s-1",
    status: "pending",
    messages: [
      message(),
      message({ id: "a-1", role: "assistant", content: "" }),
    ],
    pendingActions: [],
  })
  mocks.prepareToolExecution.mockImplementation((_tool, args) => ({ args }))
  mocks.mintMasterAgentCredential.mockResolvedValue("minted-jwt")
  mocks.createPendingAction.mockResolvedValue({ id: "action-1" })
  mocks.executeOperation.mockResolvedValue({
    ok: true,
    status: 200,
    contentType: "application/json",
    body: { done: true },
  })
  mocks.getMasterAgentCatalogTools.mockReturnValue([])
  mocks.findCurrentStateTool.mockReturnValue(undefined)
})

describe("processMasterAgent", () => {
  test("answers from the stored history and writes the reply into the pending turn", async () => {
    mocks.generateText.mockResolvedValue({
      text: "  Đã soạn nháp nhắc lịch K5 lúc 20:00 ngày 27/11.  ",
    })

    await processMasterAgent(data)

    const call = mocks.generateText.mock.calls[0]?.[0]
    expect(call.instructions).toContain("custom prompt")
    expect(call.instructions).toContain("Asia/Saigon")
    // The pending assistant row is not replayed into the prompt.
    expect(call.messages).toEqual([
      { role: "user", content: "Tóm tắt Zoom: nhóm K5, nhắc 20:00 ngày 27/11" },
    ])
    expect(call.tools.search_tools).toBeDefined()
    expect(call.tools.call_tool).toBeDefined()
    expect(call.tools.get_guide).toBeDefined()
    expect(mocks.completeTurn).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      messageId: "a-1",
      content: "Đã soạn nháp nhắc lịch K5 lúc 20:00 ngày 27/11.",
      status: "completed",
    })
  })

  test("fails the turn when the agent is not configured or disabled", async () => {
    mocks.getConfig.mockResolvedValue(null)

    await processMasterAgent(data)

    expect(mocks.completeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", content: "" }),
    )
    expect(mocks.generateText).not.toHaveBeenCalled()
  })

  test("fails the turn when no models are configured", async () => {
    mocks.getConfig.mockResolvedValue({
      enabled: true,
      autoApproveDiff: false,
      prompt: null,
      models: [],
    })

    await processMasterAgent(data)

    expect(mocks.completeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    )
  })

  test("marks the turn failed and rethrows when the session read dies", async () => {
    mocks.getSession.mockRejectedValue(new Error("db down"))

    await expect(processMasterAgent(data)).rejects.toThrow("db down")
    expect(mocks.completeTurn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    )
  })
})

describe("runCatalogTool hitl policies", () => {
  test("confirm_outbound never executes the API and records a pending action", async () => {
    const tool = toolFixture({ hitlPolicy: "confirm_outbound" })
    mocks.findCatalogToolByName.mockReturnValue(tool)

    const outcome = await runCatalogTool(turnContext, tool.name, {
      id: "b-1",
      schedulesType: "once",
    })

    expect(outcome).toEqual({
      kind: "pending",
      actionId: "action-1",
      operationId: "broadcasts.schedule",
    })
    expect(mocks.executeOperation).not.toHaveBeenCalled()
    expect(mocks.createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "broadcasts.schedule",
        policy: "confirm_outbound",
      }),
    )
  })

  test("confirm_destructive never executes even when autoApproveDiff is on", async () => {
    const tool = toolFixture({ hitlPolicy: "confirm_destructive" })
    mocks.findCatalogToolByName.mockReturnValue(tool)

    const outcome = await runCatalogTool(
      { ...turnContext, autoApproveDiff: true },
      tool.name,
      { id: "b-1" },
    )

    expect(outcome.kind).toBe("pending")
    expect(mocks.executeOperation).not.toHaveBeenCalled()
  })

  test("confirm_diff executes immediately when autoApproveDiff is on", async () => {
    const tool = toolFixture({ hitlPolicy: "confirm_diff" })
    mocks.findCatalogToolByName.mockReturnValue(tool)

    const outcome = await runCatalogTool(
      { ...turnContext, autoApproveDiff: true },
      tool.name,
      { id: "b-1" },
    )

    expect(outcome.kind).toBe("ok")
    expect(mocks.executeOperation).toHaveBeenCalledWith(
      tool,
      { id: "b-1" },
      { token: "minted-jwt" },
      30_000,
    )
    expect(mocks.createPendingAction).not.toHaveBeenCalled()
  })

  test("confirm_diff waits for approval when autoApproveDiff is off", async () => {
    const tool = toolFixture({ hitlPolicy: "confirm_diff" })
    mocks.findCatalogToolByName.mockReturnValue(tool)

    const outcome = await runCatalogTool(turnContext, tool.name, { id: "b-1" })

    expect(outcome.kind).toBe("pending")
    expect(mocks.executeOperation).not.toHaveBeenCalled()
  })

  test("policy none executes immediately", async () => {
    const tool = toolFixture({ hitlPolicy: "none", method: "GET" })
    mocks.findCatalogToolByName.mockReturnValue(tool)

    const outcome = await runCatalogTool(turnContext, tool.name, {})

    expect(outcome).toEqual({ kind: "ok", body: { done: true } })
  })

  test("the model's _confirm argument is stripped unread", async () => {
    const tool = toolFixture({ hitlPolicy: "confirm_outbound" })
    mocks.findCatalogToolByName.mockReturnValue(tool)

    const outcome = await runCatalogTool(turnContext, tool.name, {
      id: "b-1",
      _confirm: true,
    })

    // Even with _confirm: true the outbound action stays pending — the agent
    // can never self-confirm.
    expect(outcome.kind).toBe("pending")
    expect(mocks.createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.not.objectContaining({ _confirm: true }),
      }),
    )
  })

  test("an API rejection is reported to the model, not thrown", async () => {
    const tool = toolFixture({ hitlPolicy: "none" })
    mocks.findCatalogToolByName.mockReturnValue(tool)
    mocks.executeOperation.mockResolvedValue({
      ok: false,
      status: 403,
      contentType: "application/json",
      body: { error: "Forbidden" },
    })

    const outcome = await runCatalogTool(turnContext, tool.name, {})

    expect(outcome.kind).toBe("error")
    expect((outcome as { message: string }).message).toContain("403")
  })

  test("unknown tool is an error outcome", async () => {
    mocks.findCatalogToolByName.mockReturnValue(undefined)

    const outcome = await runCatalogTool(turnContext, "nope", {})

    expect(outcome.kind).toBe("error")
  })
})

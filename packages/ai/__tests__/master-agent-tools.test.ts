import type { ToolSet } from "ai"
import { beforeEach, describe, expect, test, vi } from "vitest"
import {
  getMasterAgentTools,
  masterAgentToolNames,
} from "../src/server/tools/master-agent"

const mocks = vi.hoisted(() => ({
  listGroups: vi.fn(),
  listReminders: vi.fn(),
  draftReminder: vi.fn(),
  updateReminderDraft: vi.fn(),
  stopReminder: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  MASTER_AGENT_TIMEZONE: "Asia/Saigon",
  masterAgentService: {
    listGroups: mocks.listGroups,
    listReminders: mocks.listReminders,
    draftReminder: mocks.draftReminder,
    updateReminderDraft: mocks.updateReminderDraft,
    stopReminder: mocks.stopReminder,
  },
}))

const context = {
  workspaceId: "ws-1",
  sessionId: "s-1",
  messageId: "a-1",
}

const execute = async (
  tools: ToolSet,
  name: keyof ToolSet,
  input: Record<string, unknown>,
) => {
  const entry = tools[name]
  if (!entry?.execute) {
    throw new Error(`${String(name)} has no execute`)
  }
  return await entry.execute(input, { toolCallId: "call-1", messages: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("Master Agent tool surface", () => {
  test("exposes exactly the five reminder tools", () => {
    expect(masterAgentToolNames).toEqual([
      "listGroups",
      "listReminders",
      "draftReminder",
      "updateReminderDraft",
      "stopReminder",
    ])
    expect(Object.keys(getMasterAgentTools(context)).sort()).toEqual(
      [...masterAgentToolNames].sort(),
    )
  })

  test("has no tool that could schedule, send, or delete a broadcast", () => {
    const names = Object.keys(getMasterAgentTools(context))
    for (const forbidden of ["schedule", "sendNow", "delete"]) {
      expect(names).not.toContain(forbidden)
    }
  })
})

describe("draftReminder tool", () => {
  test("creates a draft through the service and never schedules", async () => {
    mocks.draftReminder.mockResolvedValue({ id: "b-1", status: "draft" })

    await execute(getMasterAgentTools(context), "draftReminder", {
      contactId: "c-1",
      flowId: "flow-1",
      name: "Nhắc lịch K5",
      scheduledAt: "2026-11-27 20:00",
    })

    expect(mocks.draftReminder).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      messageId: "a-1",
      contactId: "c-1",
      flowId: "flow-1",
      name: "Nhắc lịch K5",
      scheduledAt: "2026-11-27 20:00",
    })
    const call = mocks.draftReminder.mock.calls[0]?.[0] ?? {}
    expect(call).not.toHaveProperty("schedulesType")
    expect(call).not.toHaveProperty("saveAsDraft")
  })
})

describe("read-only tools", () => {
  test("listGroups and listReminders stay inside the tool's workspace", async () => {
    mocks.listGroups.mockResolvedValue([])
    mocks.listReminders.mockResolvedValue([])
    const tools = getMasterAgentTools(context)

    await execute(tools, "listGroups", {})
    await execute(tools, "listReminders", {})

    expect(mocks.listGroups).toHaveBeenCalledWith({ workspaceId: "ws-1" })
    expect(mocks.listReminders).toHaveBeenCalledWith({ workspaceId: "ws-1" })
  })

  test("stopReminder targets the broadcast the model named", async () => {
    mocks.stopReminder.mockResolvedValue({ id: "b-1", status: "draft" })

    await execute(getMasterAgentTools(context), "stopReminder", {
      broadcastId: "b-1",
    })

    expect(mocks.stopReminder).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      broadcastId: "b-1",
    })
  })
})

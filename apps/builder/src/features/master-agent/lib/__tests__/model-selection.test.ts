import { describe, expect, test } from "vitest"
import {
  buildEditableMasterAgentModels,
  collectSelectedMasterAgentModels,
  masterAgentModelKey,
} from "../model-selection"

describe("buildEditableMasterAgentModels", () => {
  test("keeps the stored fallback membership and order ahead of unused choices", () => {
    const editable = buildEditableMasterAgentModels({
      storedModels: [
        { provider: "claude", model: "claude-custom" },
        { provider: "openai", model: "gpt-custom" },
      ],
      integrations: [],
    })

    expect(editable.rows.slice(0, 2)).toEqual([
      { provider: "claude", model: "claude-custom" },
      { provider: "openai", model: "gpt-custom" },
    ])
    expect(editable.selectedKeys).toEqual([
      "provider:claude",
      "provider:openai",
    ])

    const selected = collectSelectedMasterAgentModels(
      editable.rows,
      new Set(editable.selectedKeys),
    )
    expect(selected).toEqual([
      { provider: "claude", model: "claude-custom" },
      { provider: "openai", model: "gpt-custom" },
    ])
  })

  test("an unconfigured form starts with every available choice selected", () => {
    const editable = buildEditableMasterAgentModels({
      storedModels: [],
      integrations: [],
      selectAllWhenEmpty: true,
    })

    expect(editable.rows.length).toBeGreaterThan(0)
    expect(new Set(editable.selectedKeys).size).toBe(editable.rows.length)
  })

  test("an explicitly empty stored configuration stays empty", () => {
    const editable = buildEditableMasterAgentModels({
      storedModels: [],
      integrations: [],
    })

    expect(editable.selectedKeys).toEqual([])
    expect(
      collectSelectedMasterAgentModels(
        editable.rows,
        new Set(editable.selectedKeys),
      ),
    ).toEqual([])
  })

  test("openai-compatible integrations keep their stored membership", () => {
    const integration = {
      id: "int-1",
      workspaceId: "ws-1",
      name: "Custom",
      preset: "custom",
      baseURL: "https://llm.example.com/v1",
      defaultModel: "default-model",
      enabled: true,
      autoReply: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never
    const editable = buildEditableMasterAgentModels({
      storedModels: [
        { kind: "openaiCompatible", integrationId: "int-1", model: "stored" },
      ],
      integrations: [integration],
    })

    expect(editable.selectedKeys).toEqual(["openaiCompatible:int-1"])
    expect(editable.rows[0]).toEqual({
      kind: "openaiCompatible",
      integrationId: "int-1",
      model: "stored",
    })
    expect(masterAgentModelKey(editable.rows[0])).toBe("openaiCompatible:int-1")
  })
})

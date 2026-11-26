// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  hasIntegrationOfTypes: vi.fn(),
}))

vi.mock("@inboxos.io/business", () => ({
  integrationService: { hasIntegrationOfTypes: mocks.hasIntegrationOfTypes },
}))

const { hasAIIntegration } = await import(
  "../src/features/integrations/queries/get-ai-integrations"
)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("hasAIIntegration", () => {
  test("passes for a workspace whose only AI integration is OpenAI Compatible", async () => {
    // Emulates the DB: the workspace's only integration is openaiCompatible.
    mocks.hasIntegrationOfTypes.mockImplementation(
      (props: { integrationTypes: string[] }) =>
        props.integrationTypes.includes("openaiCompatible"),
    )

    await expect(hasAIIntegration("workspace-1")).resolves.toBe(true)
    expect(mocks.hasIntegrationOfTypes).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      integrationTypes: expect.arrayContaining([
        "openai",
        "gemini",
        "claude",
        "deepseek",
        "openrouter",
        "muse",
        "openaiCompatible",
      ]),
    })
  })

  test("fails when no AI integration is connected", async () => {
    mocks.hasIntegrationOfTypes.mockResolvedValue(false)

    await expect(hasAIIntegration("workspace-1")).resolves.toBe(false)
  })
})

import { NextIntlClientProvider } from "next-intl"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import messages from "../messages/en.json"
import {
  MasterAgentPendingActionCard,
  type MasterAgentPendingActionCardData,
} from "../src/features/master-agent/components/master-agent-pending-action-card"

const action: MasterAgentPendingActionCardData = {
  id: "pa-1",
  operationId: "broadcasts.schedule",
  toolName: "broadcasts_schedule",
  args: {
    id: "b-1",
    schedulesType: "once",
    schedulesAt: "2026-11-27T13:00:00Z",
  },
  policy: "confirm_outbound",
  currentState: { id: "b-1", status: "draft" },
  status: "pending",
  resourcePath: "/broadcasts/b-1",
}

describe("MasterAgentPendingActionCard", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  const render = (
    overrides: Partial<MasterAgentPendingActionCardData> = {},
    {
      isDeciding = false,
      onConfirm = vi.fn(),
      onReject = vi.fn(),
    }: {
      isDeciding?: boolean
      onConfirm?: (actionId: string) => void
      onReject?: (actionId: string) => void
    } = {},
  ) => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MasterAgentPendingActionCard
            action={{ ...action, ...overrides }}
            isDeciding={isDeciding}
            onConfirm={onConfirm}
            onReject={onReject}
            workspaceId="ws-1"
          />
        </NextIntlClientProvider>,
      )
    })
    return { onConfirm, onReject }
  }

  test("shows the operation, its proposal, and the current state", () => {
    render()

    expect(container.textContent).toContain("broadcasts.schedule")
    expect(container.textContent).toContain("schedulesAt")
    expect(container.textContent).toContain('"draft"')
  })

  test("the edit link points at the resource inside the workspace", () => {
    render()

    const link = container.querySelector("a")
    expect(link?.getAttribute("href")).toBe("/space/ws-1/broadcasts/b-1")
  })

  test("no edit link is rendered without a resource hint", () => {
    render({ resourcePath: null })

    expect(container.querySelector("a")).toBeNull()
  })

  test("confirm and reject callbacks carry the action id", () => {
    const onConfirm = vi.fn()
    const onReject = vi.fn()
    render({}, { onConfirm, onReject })

    const buttons = Array.from(container.querySelectorAll("button"))
    const confirmButton = buttons.find((button) =>
      button.textContent?.includes("Confirm"),
    )
    const rejectButton = buttons.find((button) =>
      button.textContent?.includes("Reject"),
    )
    act(() => {
      confirmButton?.click()
    })
    act(() => {
      rejectButton?.click()
    })

    expect(onConfirm).toHaveBeenCalledWith("pa-1")
    expect(onReject).toHaveBeenCalledWith("pa-1")
  })

  test("both buttons are disabled while a decision is in flight", () => {
    render({}, { isDeciding: true })

    for (const button of Array.from(container.querySelectorAll("button"))) {
      expect(button.disabled).toBe(true)
    }
  })

  test("a decided action renders read-only — the decision is final", () => {
    render({ status: "approved" })

    expect(container.querySelector("button")).toBeNull()
    expect(container.textContent).toContain("Executed")
  })

  test("an expired action renders read-only too", () => {
    render({ status: "expired" })

    expect(container.querySelector("button")).toBeNull()
  })

  test("missing current state shows the placeholder instead of empty JSON", () => {
    render({ currentState: null })

    expect(container.textContent).not.toContain("null")
  })
})

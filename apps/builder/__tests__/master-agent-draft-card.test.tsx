import { NextIntlClientProvider } from "next-intl"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import messages from "../messages/en.json"
import {
  type MasterAgentDraft,
  MasterAgentDraftCard,
} from "../src/features/master-agent/components/master-agent-draft-card"

/** 13:00Z is 20:00 in Asia/Saigon, so a formatter using the browser zone fails this. */
const draft: MasterAgentDraft = {
  id: "b-1",
  name: "Nhắc lịch K5",
  status: "draft",
  schedulesType: "future",
  schedulesAt: new Date("2026-11-27T13:00:00.000Z"),
  flowId: "flow-1",
  contactIds: ["contact-1"],
  group: {
    contactId: "contact-1",
    name: "Khoá K5",
    sourceId: "group:k5-demo",
  },
}

describe("MasterAgentDraftCard", () => {
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
    overrides: Partial<MasterAgentDraft> = {},
    {
      canConfirm = true,
      isConfirming = false,
      onConfirm = vi.fn(),
    }: {
      canConfirm?: boolean
      isConfirming?: boolean
      onConfirm?: (broadcastId: string) => void
    } = {},
  ) => {
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <MasterAgentDraftCard
            canConfirm={canConfirm}
            draft={{ ...draft, ...overrides }}
            isConfirming={isConfirming}
            onConfirm={onConfirm}
          />
        </NextIntlClientProvider>,
      )
    })
    return container
  }

  test("shows the group and the send time in Asia/Saigon", () => {
    const text = render().textContent ?? ""

    expect(text).toContain("Khoá K5")
    expect(text).toContain("group:k5-demo")
    // 20:00 Saigon, not 13:00 UTC / 1:00 PM.
    expect(text).toContain("8:00")
    expect(text).not.toContain("1:00")
    expect(text).toContain("Draft")
  })

  test("Confirm schedules the draft the card shows", () => {
    const onConfirm = vi.fn()
    const rendered = render({}, { onConfirm })

    act(() => {
      rendered.querySelector("button")?.click()
    })

    expect(onConfirm).toHaveBeenCalledWith("b-1")
  })

  test("a member without the permissions sees no Confirm action", () => {
    const rendered = render({}, { canConfirm: false })

    expect(rendered.querySelector("button")).toBeNull()
    expect(rendered.textContent).toContain(
      "You need the broadcasts and flows permissions to confirm.",
    )
  })

  test("a disabled Confirm cannot be clicked while the request runs", () => {
    const onConfirm = vi.fn()
    const rendered = render({}, { isConfirming: true, onConfirm })

    const button = rendered.querySelector("button")
    expect(button?.disabled).toBe(true)

    act(() => {
      button?.click()
    })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  test("a confirmed draft no longer offers Confirm", () => {
    const rendered = render({ status: "scheduled" })

    expect(rendered.querySelector("button")).toBeNull()
    expect(rendered.textContent).toContain("Scheduled")
  })

  test("a reminder that stopped or failed is not labelled as confirmed", () => {
    const rendered = render({ status: "cancelled" })

    expect(rendered.querySelector("button")).toBeNull()
    expect(rendered.textContent).not.toContain("Scheduled")
    expect(rendered.textContent).toContain("Cancelled")
  })
})

import {
  type AIAgentSalesProfile,
  type AIAgentTrainingProposal,
  DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
} from "@chatbotx.io/database/partials"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ProposalCard } from "../src/features/ai-agents/components/sales-training/proposal-card"
import { SalesProfileView } from "../src/features/ai-agents/components/sales-training/sales-profile-view"

vi.mock("@/lib/orpc/orpc", () => ({
  client: {
    aiAgentsAPI: {
      updateSalesProfileAPI: vi.fn(),
    },
  },
}))

vi.mock("@/lib/orpc/query", () => ({
  orpc: {
    aiAgentsAPI: {
      key: () => ["aiAgentsAPI"],
    },
  },
}))

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string | number>) =>
      values?.version === undefined ? key : `${key}:v${values.version}`,
}))

const proposedProfile: AIAgentSalesProfile = {
  enabled: true,
  tone: "Thân thiện, xưng em gọi anh/chị",
  role: "Tư vấn viên khóa học",
  objective: "Chốt đơn khóa IELTS",
  targetProducts: [
    {
      productId: "3001",
      priority: 1,
      pitchNote: "Ưu tiên cho người mới",
    },
  ],
  forbiddenTopics: ["Chính trị"],
  offTopicLimit: 3,
  handoverOnHumanRequest: true,
  handoffMessage: DEFAULT_SALES_PROFILE_HANDOFF_MESSAGE,
  handoffTriggers:
    "Đồng ý mua, muốn thanh toán, xin giảm giá ngoài chính sách, VIP 1:1",
}

const sampleProposal: AIAgentTrainingProposal = {
  proposedProfile,
  diff: [
    {
      field: "tone",
      before: "",
      after: "Thân thiện, xưng em gọi anh/chị",
    },
    {
      field: "targetProducts",
      before: [],
      after: [
        {
          productId: "3001",
          priority: 1,
          pitchNote: "Ưu tiên cho người mới",
        },
      ],
    },
  ],
  clarifyingQuestion: "Anh/chị có muốn thêm Khóa 2 làm ưu tiên 2 không?",
  unmatchedProducts: ["Khóa VIP 99"],
}

describe("ProposalCard component", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  test("renders diff rows, unmatched products, clarifying question, and calls onApply / onEdit / onCancel", () => {
    const onApply = vi.fn()
    const onEdit = vi.fn()
    const onCancel = vi.fn()
    const productNameById = new Map([["3001", "Khóa IELTS Foundation"]])

    act(() => {
      root.render(
        <ProposalCard
          onApply={onApply}
          onCancel={onCancel}
          onEdit={onEdit}
          productNameById={productNameById}
          proposal={sampleProposal}
        />,
      )
    })

    const card = container.querySelector('[data-testid="sales-proposal-card"]')
    expect(card).not.toBeNull()

    const unmatched = container.querySelector(
      '[data-testid="proposal-unmatched-products"]',
    )
    expect(unmatched?.textContent).toContain("Khóa VIP 99")

    const clarifying = container.querySelector(
      '[data-testid="proposal-clarifying-question"]',
    )
    expect(clarifying?.textContent).toContain(
      "Anh/chị có muốn thêm Khóa 2 làm ưu tiên 2 không?",
    )

    const toneRow = container.querySelector('[data-testid="diff-row-tone"]')
    expect(toneRow?.textContent).toContain("Thân thiện, xưng em gọi anh/chị")

    const targetProductsRow = container.querySelector(
      '[data-testid="diff-row-targetProducts"]',
    )
    expect(targetProductsRow?.textContent).toContain(
      "[P1] Khóa IELTS Foundation (Ưu tiên cho người mới)",
    )

    const applyBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="proposal-apply-btn"]',
    )
    act(() => applyBtn?.click())
    expect(onApply).toHaveBeenCalledWith(proposedProfile)

    const editBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="proposal-edit-btn"]',
    )
    act(() => editBtn?.click())
    expect(onEdit).toHaveBeenCalledWith(proposedProfile)

    const cancelBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="proposal-cancel-btn"]',
    )
    act(() => cancelBtn?.click())
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test("hides action buttons and displays the applied version badge when appliedVersion is set", () => {
    const onApply = vi.fn()

    act(() => {
      root.render(
        <ProposalCard
          appliedVersion={4}
          onApply={onApply}
          proposal={sampleProposal}
        />,
      )
    })

    const card = container.querySelector('[data-testid="sales-proposal-card"]')
    expect(card?.textContent).toContain("proposal.appliedBadge:v4")
    expect(
      container.querySelector('[data-testid="proposal-apply-btn"]'),
    ).toBeNull()
  })
})

describe("SalesProfileView component", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  test("preserves pitchNote input DOM node across edits and disables Add product when all products are selected", () => {
    const queryClient = new QueryClient()
    const products = [
      {
        id: "3001",
        name: "Khóa IELTS Foundation",
        price: 1_990_000,
        currency: "VND",
      },
    ]

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SalesProfileView
            aiAgentId="agent-1"
            products={products}
            profile={proposedProfile}
            version={1}
            workspaceId="ws-1"
          />
        </QueryClientProvider>,
      )
    })

    const addBtn = [...container.querySelectorAll("button")].find((btn) =>
      btn.textContent?.includes("profile.addProduct"),
    )
    expect(addBtn?.disabled).toBe(true)

    const pitchInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="profile.pitchNotePlaceholder"]',
    )
    expect(pitchInput).not.toBeNull()
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set
    act(() => {
      setValue?.call(pitchInput, "Ưu tiên cho người mới updated")
      pitchInput?.dispatchEvent(new Event("input", { bubbles: true }))
      pitchInput?.dispatchEvent(new Event("change", { bubbles: true }))
    })

    const pitchInputAfter = container.querySelector<HTMLInputElement>(
      'input[placeholder="profile.pitchNotePlaceholder"]',
    )
    expect(pitchInputAfter).toBe(pitchInput)
  })
})

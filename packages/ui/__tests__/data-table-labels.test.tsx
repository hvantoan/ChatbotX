import {
  createColumnHelper,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { DataTable } from "../src/components/data-table/data-table"
import { DataTableColumnHeader } from "../src/components/data-table/data-table-column-header"
import {
  type DataTableLabels,
  DataTableLabelsProvider,
} from "../src/components/data-table/data-table-labels"

type Contact = { id: string; name: string }

const helper = createColumnHelper<Contact>()
const COLUMNS = [helper.accessor("name", { header: "Name" })]

const PT_BR: DataTableLabels = {
  noResults: "Nenhum resultado.",
  selectedRows: (selected, total) =>
    `${selected} de ${total} linha(s) selecionada(s).`,
  rowsPerPage: "Linhas por página",
  pageOf: (page, pageCount) => `Página ${page} de ${pageCount}`,
  nextPage: "Ir para a próxima página",
  sortAscending: "Crescente",
  sortDescending: "Decrescente",
  resetSorting: "Redefinir ordenação",
  hideColumn: "Ocultar coluna",
}

function Harness({
  data,
  labels,
}: {
  data: Contact[]
  labels?: DataTableLabels
}) {
  const table = useReactTable({
    data,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
  })
  return <DataTable labels={labels} table={table} />
}

function ColumnHeaderHarness() {
  const table = useReactTable({
    data: [{ id: "1", name: "Ada" }],
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { sorting: [{ id: "name", desc: false }] },
  })
  const column = table.getColumn("name")
  if (!column) {
    throw new Error("missing name column")
  }
  return <DataTableColumnHeader column={column} title="Name" />
}

describe("DataTable labels", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
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

  test("keeps the English labels when no provider is mounted", () => {
    act(() => {
      root.render(<Harness data={[{ id: "1", name: "Ada" }]} />)
    })

    expect(container.textContent).toContain("0 of 1 row(s) selected.")
    expect(container.textContent).toContain("Rows per page")
    expect(container.textContent).toContain("Page 1 of 1")
  })

  test("uses the labels given by DataTableLabelsProvider", () => {
    act(() => {
      root.render(
        <DataTableLabelsProvider value={PT_BR}>
          <Harness data={[]} />
        </DataTableLabelsProvider>,
      )
    })

    expect(container.textContent).toContain("Nenhum resultado.")
    expect(container.textContent).toContain("0 de 0 linha(s) selecionada(s).")
    expect(container.textContent).toContain("Linhas por página")
    expect(container.textContent).toContain("Página 1 de 0")
    expect(
      container.querySelector('[aria-label="Ir para a próxima página"]'),
    ).not.toBeNull()
    expect(container.textContent).not.toContain("Rows per page")
  })

  test("uses provider labels in the column sorting menu", async () => {
    act(() => {
      root.render(
        <DataTableLabelsProvider value={PT_BR}>
          <ColumnHeaderHarness />
        </DataTableLabelsProvider>,
      )
    })

    const trigger = container.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-trigger"]',
    )
    expect(trigger).not.toBeNull()

    await act(async () => {
      trigger?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Crescente")
    expect(document.body.textContent).toContain("Decrescente")
    expect(document.body.textContent).toContain("Ocultar coluna")
    expect(document.body.textContent).toContain("Redefinir ordenação")
    expect(document.body.textContent).not.toContain("Asc")
  })

  test("lets a table's own labels win key by key over the provider", () => {
    act(() => {
      root.render(
        <DataTableLabelsProvider value={PT_BR}>
          <Harness data={[]} labels={{ noResults: "Sem contatos" }} />
        </DataTableLabelsProvider>,
      )
    })

    expect(container.textContent).toContain("Sem contatos")
    expect(container.textContent).not.toContain("Nenhum resultado.")
    expect(container.textContent).toContain("Linhas por página")
  })
})

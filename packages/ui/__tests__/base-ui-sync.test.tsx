import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../src/components/ui/alert-dialog"
import { CommandDialog } from "../src/components/ui/command"
import { HoverCard, HoverCardContent } from "../src/components/ui/hover-card"
import {
  Menubar,
  MenubarContent,
  MenubarMenu,
  MenubarTrigger,
} from "../src/components/ui/menubar"
import { Tabs, TabsList, TabsTrigger } from "../src/components/ui/tabs"

describe("Base UI synchronization invariants", () => {
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

  test("TabsList renders TabsTrigger as direct children and supports line and pills variants", () => {
    act(() => {
      root.render(
        <Tabs defaultValue="a">
          <TabsList data-testid="line-list">
            <TabsTrigger value="a">Tab A</TabsTrigger>
            <TabsTrigger value="b">Tab B</TabsTrigger>
          </TabsList>
          <TabsList data-testid="pills-list" variant="pills">
            <TabsTrigger value="a">Tab A</TabsTrigger>
          </TabsList>
        </Tabs>,
      )
    })

    const lineList = container.querySelector('[data-testid="line-list"]')
    const pillsList = container.querySelector('[data-testid="pills-list"]')

    expect(lineList?.getAttribute("data-variant")).toBe("line")
    expect(lineList?.children).toHaveLength(2)
    expect(lineList?.firstElementChild?.getAttribute("data-slot")).toBe(
      "tabs-trigger",
    )
    expect(pillsList?.getAttribute("data-variant")).toBe("pills")
  })

  test("CommandDialog renders DialogTitle inside dialog-content", () => {
    act(() => {
      root.render(
        <CommandDialog open title="Search">
          <div>Item</div>
        </CommandDialog>,
      )
    })

    const content = document.querySelector('[data-slot="dialog-content"]')
    const title = content?.querySelector('[data-slot="dialog-title"]')
    expect(content).not.toBeNull()
    expect(title?.textContent).toBe("Search")
  })

  test("AlertDialogContent keeps mobile width guard and AlertDialogAction/Cancel emit data-slot", () => {
    act(() => {
      root.render(
        <AlertDialog open>
          <AlertDialogContent className="max-w-lg">
            <AlertDialogTitle>Confirm</AlertDialogTitle>
            <AlertDialogDescription>Proceed?</AlertDialogDescription>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogContent>
        </AlertDialog>,
      )
    })

    const content = document.querySelector('[data-slot="alert-dialog-content"]')
    expect(content?.className).toContain("w-[calc(100%-2rem)]")
    expect(content?.className).toContain("max-w-lg")
    expect(
      document.querySelector('[data-slot="alert-dialog-action"]'),
    ).not.toBeNull()
    expect(
      document.querySelector('[data-slot="alert-dialog-cancel"]'),
    ).not.toBeNull()
  })

  test("HoverCardContent and MenubarContent do not leak side or alignOffset onto popup DOM", () => {
    act(() => {
      root.render(
        <>
          <HoverCard open>
            <HoverCardContent alignOffset={12} side="right">
              Hover body
            </HoverCardContent>
          </HoverCard>
          <Menubar>
            <MenubarMenu open>
              <MenubarTrigger>File</MenubarTrigger>
              <MenubarContent alignOffset={8} side="top">
                Menu body
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        </>,
      )
    })

    const hoverPopup = document.querySelector(
      '[data-slot="hover-card-content"]',
    )
    const menubarPopup = document.querySelector('[data-slot="menubar-content"]')

    expect(hoverPopup).not.toBeNull()
    expect(hoverPopup?.hasAttribute("alignoffset")).toBe(false)
    expect(hoverPopup?.getAttribute("data-side")).toBe("right")

    expect(menubarPopup).not.toBeNull()
    expect(menubarPopup?.getAttribute("data-side")).toBe("top")
    expect(menubarPopup?.hasAttribute("alignoffset")).toBe(false)
  })
})

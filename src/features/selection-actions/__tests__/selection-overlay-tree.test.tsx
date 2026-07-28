// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SelectionActionsOverlay } from "../components/selection-actions-overlay"
import {
  type SelectionOverlayContextValue,
  SelectionOverlayProvider,
  useSelectionOverlay
} from "../selection-overlay-context"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key
  })
}))

const makeActions = () => ({
  runAction: vi.fn(),
  changeModel: vi.fn(),
  toggleMore: vi.fn(),
  togglePin: vi.fn(),
  copy: vi.fn(),
  replace: vi.fn(),
  insertBelow: vi.fn(),
  openChat: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  back: vi.fn(),
  close: vi.fn(),
  setCustomInstruction: vi.fn(),
  runCustom: vi.fn(),
  startDrag: vi.fn()
})

const renderOverlay = (
  overrides: Partial<SelectionOverlayContextValue> = {}
) => {
  const actions = makeActions()
  const value: SelectionOverlayContextValue = {
    mode: "panel",
    panelState: "done",
    currentAction: "summarize",
    enabledActionIds: ["summarize", "explain", "custom"],
    isMoreMenuOpen: false,
    resultText: "A summary",
    errorText: "",
    isThinking: false,
    thinkingText: "",
    availableModels: [],
    panelModel: "llama3",
    canReplace: true,
    canInsert: true,
    isPinned: false,
    customInstruction: "",
    tooltipContainer: null,
    actions,
    ...overrides
  }
  return {
    actions: value.actions,
    ...render(
      <SelectionOverlayProvider value={value}>
        <SelectionActionsOverlay />
      </SelectionOverlayProvider>
    )
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SelectionActionsOverlay mode switch", () => {
  it("renders the toolbar in toolbar mode", () => {
    renderOverlay({ mode: "toolbar" })
    expect(
      screen.getByRole("toolbar", { name: "Selection actions" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("renders the panel in panel mode", () => {
    renderOverlay({ mode: "panel" })
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument()
  })
})

describe("panel reaches the context actions", () => {
  it("wires the footer's apply buttons", () => {
    const { actions } = renderOverlay()

    fireEvent.click(
      screen.getByRole("button", { name: "selection_button.panel.replace" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "selection_button.panel.insert" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "selection_button.panel.copy" })
    )

    expect(actions.replace).toHaveBeenCalledOnce()
    expect(actions.insertBelow).toHaveBeenCalledOnce()
    expect(actions.copy).toHaveBeenCalledOnce()
  })

  it("wires the header's back, pin and close buttons", () => {
    const { actions } = renderOverlay()

    fireEvent.click(
      screen.getByRole("button", { name: "selection_button.panel.back" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "selection_button.panel.pin" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "selection_button.panel.close" })
    )

    expect(actions.back).toHaveBeenCalledOnce()
    expect(actions.togglePin).toHaveBeenCalledOnce()
    expect(actions.close).toHaveBeenCalledOnce()
  })

  it("runs the action the header select switches to", () => {
    const { actions, container } = renderOverlay()
    const select = container.querySelector(
      ".sa-action-select"
    ) as HTMLSelectElement

    expect(select.value).toBe("summarize")
    fireEvent.change(select, { target: { value: "explain" } })

    expect(actions.runAction).toHaveBeenCalledWith("explain")
  })

  it("hides insert and replace when the capture cannot take them", () => {
    renderOverlay({ canReplace: false, canInsert: false })

    expect(
      screen.queryByRole("button", { name: "selection_button.panel.replace" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "selection_button.panel.insert" })
    ).not.toBeInTheDocument()
  })

  it("shows cancel only while streaming", () => {
    const { unmount } = renderOverlay({ panelState: "done" })
    expect(
      screen.queryByRole("button", { name: "selection_button.panel.cancel" })
    ).not.toBeInTheDocument()
    unmount()

    renderOverlay({ panelState: "streaming" })
    expect(
      screen.getByRole("button", { name: "selection_button.panel.cancel" })
    ).toBeInTheDocument()
  })

  it("submits the custom instruction form", () => {
    const { actions } = renderOverlay({
      currentAction: "custom",
      panelState: "open",
      resultText: "",
      customInstruction: "translate to French"
    })

    fireEvent.click(
      screen.getByRole("button", { name: "selection_button.panel.run" })
    )

    expect(actions.runCustom).toHaveBeenCalledOnce()
  })

  it("does not submit an empty custom instruction", () => {
    const { actions } = renderOverlay({
      currentAction: "custom",
      panelState: "open",
      resultText: "",
      customInstruction: "   "
    })

    fireEvent.submit(
      screen
        .getByLabelText("Custom prompt instruction")
        .closest("form") as HTMLFormElement
    )

    expect(actions.runCustom).not.toHaveBeenCalled()
  })
})

describe("toolbar reaches the context actions", () => {
  it("wires close and the more toggle", () => {
    const { actions } = renderOverlay({ mode: "toolbar" })

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "selection_button.panel.close" })
    )
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "selection_button.panel.more" })
    )

    expect(actions.close).toHaveBeenCalledOnce()
    expect(actions.toggleMore).toHaveBeenCalledOnce()
  })

  it("renders the more menu only when it is open", () => {
    const { unmount } = renderOverlay({
      mode: "toolbar",
      isMoreMenuOpen: false
    })
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    unmount()

    renderOverlay({ mode: "toolbar", isMoreMenuOpen: true })
    expect(screen.getByRole("menu")).toBeInTheDocument()
  })
})

describe("useSelectionOverlay", () => {
  it("fails loudly outside a provider rather than rendering an empty overlay", () => {
    const Probe = () => {
      useSelectionOverlay()
      return null
    }
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => render(<Probe />)).toThrow(/SelectionOverlayProvider/)

    error.mockRestore()
  })
})

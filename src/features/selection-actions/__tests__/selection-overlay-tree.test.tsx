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
  refine: vi.fn(),
  startDrag: vi.fn(),
  nudge: vi.fn(),
  undo: vi.fn()
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
    resultText: "A summary",
    errorText: "",
    errorKey: "",
    notice: null,
    canUndo: false,
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
      screen.getByRole("toolbar", {
        name: "selection_button.panel.toolbar_label"
      })
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
  it("offers Cancel to recover a result after refinement fails", () => {
    const { actions } = renderOverlay({
      panelState: "error",
      canRestoreResult: true
    })
    fireEvent.click(
      screen.getByRole("button", { name: "selection_button.panel.cancel" })
    )
    expect(actions.cancel).toHaveBeenCalledOnce()
  })

  it("shows a legacy model once when its catalog identity is unambiguous", () => {
    renderOverlay({
      panelModel: "shared",
      availableModels: [
        {
          model: "shared",
          name: "Shared",
          providerId: "ollama",
          providerName: "Ollama"
        }
      ] as SelectionOverlayContextValue["availableModels"]
    })
    const picker = screen.getByRole("combobox", {
      name: "selection_button.panel.model_label"
    }) as HTMLSelectElement
    expect(picker.options).toHaveLength(1)
    expect(picker.selectedOptions[0]).toHaveTextContent("Ollama")
  })

  it("does not guess between providers for an ambiguous legacy model", () => {
    renderOverlay({
      panelModel: "shared",
      availableModels: [
        { model: "shared", providerId: "custom:first", providerName: "First" },
        { model: "shared", providerId: "custom:second", providerName: "Second" }
      ] as SelectionOverlayContextValue["availableModels"]
    })
    const picker = screen.getByRole("combobox", {
      name: "selection_button.panel.model_label"
    }) as HTMLSelectElement
    expect(picker.selectedOptions[0]).toHaveTextContent("shared")
    expect(picker.value).toBe(JSON.stringify(["", "shared"]))
  })
  it("keeps same-named models on different providers distinct", () => {
    const { actions } = renderOverlay({
      panelModel: "shared-model",
      panelProviderId: "custom:second",
      availableModels: [
        {
          model: "shared-model",
          name: "Shared",
          providerId: "custom:first",
          providerName: "First"
        },
        {
          model: "shared-model",
          name: "Shared",
          providerId: "custom:second",
          providerName: "Second"
        }
      ] as SelectionOverlayContextValue["availableModels"]
    })
    const select = screen.getByRole("combobox", {
      name: "selection_button.panel.model_label"
    }) as HTMLSelectElement
    expect(select.selectedOptions[0]).toHaveTextContent("Second")
    const first = screen.getByRole("option", {
      name: "Shared · First"
    }) as HTMLOptionElement
    fireEvent.change(select, { target: { value: first.value } })
    expect(actions.changeModel).toHaveBeenCalledWith(
      "shared-model",
      "custom:first"
    )
  })

  it("refines a completed result with a nonempty instruction", () => {
    const { actions } = renderOverlay()
    const input = screen.getByRole("textbox", {
      name: "selection_button.panel.refine_label"
    })
    const button = screen.getByRole("button", {
      name: "selection_button.panel.refine"
    })
    expect(button).toBeDisabled()
    fireEvent.change(input, { target: { value: "  Make it shorter  " } })
    fireEvent.click(button)
    expect(actions.refine).toHaveBeenCalledWith("Make it shorter")
  })

  it("previews literal replacement text with separate word changes", () => {
    const { container } = renderOverlay({
      originalText: "A red fox <script>original</script>",
      resultText: "A blue fox <script>proposed</script>"
    })
    expect(container.querySelector(".sa-preview summary")).toHaveTextContent(
      "selection_button.panel.preview_changes"
    )
    expect(container.querySelector(".sa-preview del")).toHaveTextContent("red")
    expect(container.querySelector(".sa-preview ins")).toHaveTextContent("blue")
    expect(container.querySelector(".sa-preview script")).toBeNull()
    expect(container.querySelector(".sa-preview")).toHaveTextContent(
      "<script>proposed</script>"
    )
  })

  it("previews exactly the trimmed text Replace writes", () => {
    const { container } = renderOverlay({
      originalText: "Original",
      resultText: "\n  Replacement  \n"
    })
    expect(container.querySelectorAll(".sa-preview-text")[1]?.textContent).toBe(
      "Replacement"
    )
  })

  it("hides refinement and preview while generation is in progress", () => {
    const { container } = renderOverlay({
      panelState: "streaming",
      canReplace: false
    })
    expect(container.querySelector(".sa-preview")).toBeNull()
    expect(
      screen.queryByRole("textbox", {
        name: "selection_button.panel.refine_label"
      })
    ).not.toBeInTheDocument()
  })
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
        .getByLabelText("selection_button.panel.custom_instruction_label")
        .closest("form") as HTMLFormElement
    )

    expect(actions.runCustom).not.toHaveBeenCalled()
  })
})

describe("toolbar reaches the context actions", () => {
  it("renders the tooltip-wrapped grip and supports dragging and keyboard nudging", () => {
    const { actions } = renderOverlay({ mode: "toolbar" })
    const grip = screen.getByRole("button", {
      name: "selection_button.panel.drag_toolbar"
    })
    expect(grip.querySelector("svg")).not.toBeNull()
    expect(grip).toHaveAttribute("data-slot", "tooltip-trigger")
    fireEvent.pointerDown(grip)
    expect(actions.startDrag).toHaveBeenCalledOnce()
    fireEvent.keyDown(grip, { key: "ArrowRight" })
    expect(actions.nudge).toHaveBeenCalledWith(12, 0)
  })

  it("hides More when every enabled action is already on the toolbar", () => {
    renderOverlay({
      mode: "toolbar",
      enabledActionIds: ["summarize", "explain"]
    })
    expect(
      screen.queryByRole("combobox", { name: "selection_button.panel.more" })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it("wires close and lists only enabled overflow actions", () => {
    const { actions } = renderOverlay({ mode: "toolbar" })

    fireEvent.click(
      screen.getByRole("button", { name: "selection_button.panel.close" })
    )
    const picker = screen.getByRole("combobox", {
      name: "selection_button.panel.more"
    })
    expect(picker).toHaveValue("")
    expect(
      screen.getByRole("option", {
        name: "selection_button.actions.custom.label"
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("option", {
        name: "selection_button.actions.shorten.label"
      })
    ).not.toBeInTheDocument()

    expect(actions.close).toHaveBeenCalledOnce()
  })

  /**
   * Enter and Space on a button dispatch click, never pointerdown, so an
   * action bound to pointerdown alone was unreachable from the keyboard.
   */
  it("runs actions on click (keyboard activation), not on pointerdown alone", () => {
    const { actions } = renderOverlay({
      mode: "toolbar",
      enabledActionIds: ["summarize", "shorten"]
    })
    const summarize = screen.getByRole("button", {
      name: "selection_button.actions.summarize.short"
    })

    const pointerDown = fireEvent.pointerDown(summarize)
    expect(pointerDown).toBe(false)
    expect(actions.runAction).not.toHaveBeenCalled()

    fireEvent.click(summarize)
    expect(actions.runAction).toHaveBeenCalledWith("summarize")

    fireEvent.change(
      screen.getByRole("combobox", { name: "selection_button.panel.more" }),
      { target: { value: "shorten" } }
    )
    expect(actions.runAction).toHaveBeenCalledWith("shorten")
  })
})

describe("panel accessibility and feedback", () => {
  it("is a non-modal dialog that takes focus on open", () => {
    renderOverlay()
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveAttribute("aria-modal", "false")
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it("names both header selects", () => {
    renderOverlay({
      availableModels: [
        {
          name: "llama3",
          model: "llama3",
          providerId: "ollama"
        } as SelectionOverlayContextValue["availableModels"][number]
      ]
    })
    expect(
      screen.getByRole("combobox", {
        name: "selection_button.panel.action_label"
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("combobox", {
        name: "selection_button.panel.model_label"
      })
    ).toBeInTheDocument()
  })

  it("shows a placeholder instead of the first model when none is chosen", () => {
    renderOverlay({
      panelModel: "",
      availableModels: [
        {
          name: "gemma3:4b",
          model: "gemma3:4b",
          providerId: "ollama"
        } as SelectionOverlayContextValue["availableModels"][number]
      ]
    })
    const select = screen.getByRole("combobox", {
      name: "selection_button.panel.model_label"
    }) as HTMLSelectElement
    expect(select.value).toBe("")
    expect(select.selectedOptions[0]?.textContent).toBe(
      "selection_button.panel.model_placeholder"
    )
  })

  it("renders a keyed failure as an alert in the overlay's own words", () => {
    renderOverlay({
      panelState: "error",
      resultText: "",
      errorText: "",
      errorKey: "selection_button.panel.no_model"
    })
    expect(screen.getByRole("alert")).toHaveTextContent(
      "selection_button.panel.no_model"
    )
  })

  it("exposes the reasoning toggle's state", () => {
    renderOverlay({ thinkingText: "Considering the text" })
    const toggle = screen.getByRole("button", {
      name: "selection_button.panel.reasoning_done"
    })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
  })

  it("marks the result busy while streaming", () => {
    const { container } = renderOverlay({ panelState: "streaming" })
    const result = container.querySelector(".sa-result")
    expect(result).toHaveAttribute("aria-live", "polite")
    expect(result).toHaveAttribute("aria-busy", "true")
  })

  it("confirms a copy and reports a failed one", () => {
    const { unmount } = renderOverlay({
      notice: "copied",
      canUndo: true,
      canInsert: false,
      canReplace: false
    })
    expect(
      screen.getByRole("button", { name: "selection_button.panel.copied" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "selection_button.panel.undo" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "selection_button.panel.insert" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "selection_button.panel.replace" })
    ).not.toBeInTheDocument()
    unmount()

    renderOverlay({ notice: "copy_failed" })
    expect(screen.getByRole("alert")).toHaveTextContent(
      "selection_button.panel.copy_failed"
    )
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

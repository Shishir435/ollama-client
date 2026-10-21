import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONTENT_EXTRACTION_CONFIG } from "@/lib/constants/config"
import type { ContentExtractionConfig, ProviderModel } from "@/types"
import type { SelectionCapture } from "../dom"
import { SelectionOverlayApp } from "../selection-overlay-app"

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key
  })
}))

vi.mock("../content-stream", () => ({
  startSelectionActionStream: vi.fn(() => ({
    disconnect: vi.fn(),
    postMessage: vi.fn()
  })),
  stopSelectionStream: vi.fn(() => null)
}))

vi.mock("../content-settings", () => ({
  loadAvailablePanelModels: vi.fn().mockResolvedValue([])
}))

vi.mock("../overlay-position", () => ({
  placeSelectionOverlay: vi.fn(),
  startOverlayDrag: vi.fn()
}))

vi.mock("../content-result-actions", () => ({
  copySelectionResult: vi.fn().mockResolvedValue(undefined),
  replaceCapturedSelection: vi.fn().mockReturnValue(false),
  insertBelowCapturedSelection: vi.fn().mockReturnValue(false),
  openSelectionResultInChat: vi.fn().mockResolvedValue(false)
}))

vi.mock("@/lib/retained-runtime-messages", () => ({
  sendRuntimeMessage: vi.fn().mockResolvedValue(undefined)
}))

// Stub SelectionActionsOverlay — exposes each action as a named button so tests
// can trigger it without depending on translations or icon layout. It reads the
// overlay context, which is also what the real tree does, so a missing provider
// fails here rather than silently rendering nothing.
vi.mock("../components/selection-actions-overlay", async () => {
  const { useSelectionOverlay } = await import("../selection-overlay-context")
  return {
    SelectionActionsOverlay: () => {
      const { mode, panelState, notice, panelModel, actions } =
        useSelectionOverlay()
      return (
        <div
          data-testid="overlay"
          data-mode={mode}
          data-panel-state={panelState}
          data-notice={notice ?? ""}
          data-model={panelModel}>
          <button type="button" onClick={actions.copy}>
            copy
          </button>
          <button type="button" onClick={actions.replace}>
            replace
          </button>
          <button
            type="button"
            onClick={() => actions.changeModel("qwen3", "ollama")}>
            change-model
          </button>
          <button type="button" onClick={() => actions.runAction("summarize")}>
            run-summarize
          </button>
          <button type="button" onClick={() => actions.runAction("shorten")}>
            run-shorten
          </button>
          <button type="button" onClick={() => actions.runAction("custom")}>
            run-custom
          </button>
          <button type="button" onClick={actions.cancel}>
            cancel
          </button>
          <button type="button" onClick={actions.back}>
            back
          </button>
          <button type="button" onClick={actions.close}>
            close
          </button>
          <button type="button" onClick={actions.retry}>
            retry
          </button>
          <button type="button" onClick={actions.runCustom}>
            run-custom-submit
          </button>
          <button type="button" onClick={actions.toggleMore}>
            toggle-more
          </button>
        </div>
      )
    }
  }
})

// ── fixtures ──────────────────────────────────────────────────────────────────

import * as contentResultActions from "../content-result-actions"
import * as contentSettings from "../content-settings"
import * as contentStream from "../content-stream"

const makeCapture = (): SelectionCapture => ({
  text: "Hello world",
  rect: {
    top: 100,
    bottom: 120,
    left: 50,
    right: 250,
    width: 200,
    height: 20
  } as DOMRect,
  range: undefined,
  canReplace: false,
  canInsert: false,
  selectionType: "plain-text"
})

const makeConfig = (): ContentExtractionConfig => ({
  ...DEFAULT_CONTENT_EXTRACTION_CONFIG
})

interface Props {
  captureOverride?: SelectionCapture | null
  modelsPreloaded?: boolean
}

const renderApp = ({
  captureOverride,
  modelsPreloaded = false
}: Props = {}) => {
  const container = document.createElement("div")
  document.body.appendChild(container)

  const configRef = { current: makeConfig() }
  const captureRef = {
    current: captureOverride !== undefined ? captureOverride : makeCapture()
  }
  const modelsRef: { current: ProviderModel[] } = {
    current: modelsPreloaded
      ? [
          {
            name: "llama3",
            model: "llama3",
            modified_at: "",
            size: 0,
            digest: "",
            providerId: "ollama",
            details: {
              parent_model: "",
              format: "",
              family: "",
              families: [],
              parameter_size: "",
              quantization_level: ""
            }
          }
        ]
      : []
  }
  const panelModelRef = { current: "" }
  const panelProviderIdRef = { current: undefined as string | undefined }
  const panelActiveRef = { current: false }
  let rerenderApp = () => {}
  const onModelChange = vi.fn((model: string, providerId?: string) => {
    panelModelRef.current = model
    panelProviderIdRef.current = providerId
    rerenderApp()
  })
  const onClose = vi.fn()
  const onModelsLoaded = (models: ProviderModel[]) => {
    modelsRef.current = models
    rerenderApp()
  }

  const app = () => (
    <SelectionOverlayApp
      container={container}
      tooltipContainer={null}
      config={configRef.current}
      capture={captureRef.current}
      models={modelsRef.current}
      panelModel={panelModelRef.current}
      panelProviderId={panelProviderIdRef.current}
      onPanelActiveChange={(active) => {
        panelActiveRef.current = active
      }}
      onModelsLoaded={onModelsLoaded}
      setContainerVisible={(visible) => {
        container.style.display = visible ? "block" : "none"
      }}
      onModelChange={onModelChange}
      onClose={onClose}
    />
  )
  const result = render(app())
  rerenderApp = () => result.rerender(app())

  return {
    ...result,
    container,
    configRef,
    captureRef,
    modelsRef,
    panelActiveRef,
    onClose
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
  cleanup()
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

// ── rendering ─────────────────────────────────────────────────────────────────

describe("SelectionOverlayApp rendering", () => {
  it("renders toolbar on mount (initial state is toolbar mode)", () => {
    const { getByTestId } = renderApp()
    expect(getByTestId("overlay")).toHaveAttribute("data-mode", "toolbar")
  })

  it("shows container on mount", () => {
    const { container } = renderApp()
    // placement effect sets display:block when not hidden
    expect(container.style.display).not.toBe("none")
  })
})

// ── stream lifecycle ──────────────────────────────────────────────────────────

// Helper: click then flush timers in a separate act so React commits the
// state update from dispatch() before setTimeout(startStream, 0) fires.
const clickAndFlush = async (
  getByText: (text: string) => HTMLElement,
  label: string
) => {
  await act(async () => {
    fireEvent.click(getByText(label))
  })
  await act(async () => {
    vi.runAllTimers()
  })
}

describe("stream lifecycle", () => {
  it("starts stream when a non-custom action is clicked", async () => {
    const { getByText } = renderApp()
    await clickAndFlush(getByText, "run-summarize")
    expect(contentStream.startSelectionActionStream).toHaveBeenCalledOnce()
  })

  it("starts stream for more-menu actions (e.g. shorten)", async () => {
    const { getByText } = renderApp()
    await clickAndFlush(getByText, "run-shorten")

    expect(contentStream.startSelectionActionStream).toHaveBeenCalledOnce()
    const [opts] = vi.mocked(contentStream.startSelectionActionStream).mock
      .calls[0]
    expect(opts.state.currentAction).toBe("shorten")
  })

  it("does NOT start stream when custom action is clicked", async () => {
    const { getByText } = renderApp()
    await clickAndFlush(getByText, "run-custom")
    expect(contentStream.startSelectionActionStream).not.toHaveBeenCalled()
  })

  it("cancel stops stream and does NOT restart it", async () => {
    const { getByText } = renderApp()

    await clickAndFlush(getByText, "run-summarize")
    expect(contentStream.startSelectionActionStream).toHaveBeenCalledTimes(1)

    await clickAndFlush(getByText, "cancel")

    expect(contentStream.stopSelectionStream).toHaveBeenCalled()
    expect(contentStream.startSelectionActionStream).toHaveBeenCalledTimes(1)
  })

  it("back stops stream and does NOT restart it", async () => {
    const { getByText } = renderApp()

    await clickAndFlush(getByText, "run-summarize")
    await clickAndFlush(getByText, "back")

    expect(contentStream.stopSelectionStream).toHaveBeenCalled()
    expect(contentStream.startSelectionActionStream).toHaveBeenCalledTimes(1)
  })

  it("retry stops the current stream and starts a new one", async () => {
    const { getByText } = renderApp()

    await clickAndFlush(getByText, "run-summarize")
    expect(contentStream.startSelectionActionStream).toHaveBeenCalledTimes(1)

    await clickAndFlush(getByText, "retry")

    expect(contentStream.stopSelectionStream).toHaveBeenCalled()
    expect(contentStream.startSelectionActionStream).toHaveBeenCalledTimes(2)
  })

  it("stops stream on unmount", async () => {
    const { unmount, getByText } = renderApp()

    await clickAndFlush(getByText, "run-summarize")
    unmount()

    expect(contentStream.stopSelectionStream).toHaveBeenCalled()
  })

  it("does not start stream when capture is null", async () => {
    const { getByText } = renderApp({ captureOverride: null })
    await clickAndFlush(getByText, "run-summarize")
    expect(contentStream.startSelectionActionStream).not.toHaveBeenCalled()
  })
})

// ── panelActiveRef sync ───────────────────────────────────────────────────────

describe("panelActiveRef sync", () => {
  it("is false initially (toolbar mode)", () => {
    const { panelActiveRef } = renderApp()
    expect(panelActiveRef.current).toBe(false)
  })

  it("becomes true when an action opens the panel", async () => {
    const { getByText, panelActiveRef } = renderApp()
    await clickAndFlush(getByText, "run-summarize")
    expect(panelActiveRef.current).toBe(true)
  })

  it("returns to false when back is clicked", async () => {
    const { getByText, panelActiveRef } = renderApp()

    await clickAndFlush(getByText, "run-summarize")
    expect(panelActiveRef.current).toBe(true)

    await clickAndFlush(getByText, "back")
    expect(panelActiveRef.current).toBe(false)
  })
})

// ── model loading ─────────────────────────────────────────────────────────────

describe("model loading", () => {
  it("defers model loading until the toolbar expands", async () => {
    const { getByText } = renderApp({ modelsPreloaded: false })

    expect(contentSettings.loadAvailablePanelModels).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(getByText("run-summarize"))
      vi.runAllTimers()
    })

    expect(contentSettings.loadAvailablePanelModels).toHaveBeenCalledOnce()
  })

  it("refreshes cached models when the panel opens", async () => {
    const { getByText, modelsRef } = renderApp({ modelsPreloaded: true })
    vi.mocked(contentSettings.loadAvailablePanelModels).mockResolvedValueOnce(
      []
    )

    await act(async () => {
      fireEvent.click(getByText("run-summarize"))
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(contentSettings.loadAvailablePanelModels).toHaveBeenCalledOnce()
    expect(modelsRef.current).toEqual([])
  })

  it("keeps cached models when model discovery fails", async () => {
    const { getByText, modelsRef } = renderApp({ modelsPreloaded: true })
    const cachedModels = [...modelsRef.current]
    vi.mocked(contentSettings.loadAvailablePanelModels).mockResolvedValueOnce(
      null
    )

    await act(async () => {
      fireEvent.click(getByText("run-summarize"))
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(contentSettings.loadAvailablePanelModels).toHaveBeenCalledOnce()
    expect(modelsRef.current).toEqual(cachedModels)
  })
})

// ── result feedback ───────────────────────────────────────────────────────────

describe("result feedback", () => {
  it("confirms a copy, then clears the confirmation", async () => {
    vi.mocked(contentResultActions.copySelectionResult).mockResolvedValueOnce(
      true
    )
    const { getByText, getByTestId } = renderApp()

    await act(async () => {
      fireEvent.click(getByText("copy"))
    })
    expect(getByTestId("overlay")).toHaveAttribute("data-notice", "copied")

    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    expect(getByTestId("overlay")).toHaveAttribute("data-notice", "")
  })

  it("reports a rejected copy", async () => {
    vi.mocked(contentResultActions.copySelectionResult).mockResolvedValueOnce(
      false
    )
    const { getByText, getByTestId } = renderApp()

    await act(async () => {
      fireEvent.click(getByText("copy"))
    })
    expect(getByTestId("overlay")).toHaveAttribute("data-notice", "copy_failed")
  })

  it("reports a replace the page refused instead of doing nothing", async () => {
    const { getByText, getByTestId, onClose } = renderApp()

    await act(async () => {
      fireEvent.click(getByText("replace"))
    })
    expect(getByTestId("overlay")).toHaveAttribute(
      "data-notice",
      "apply_failed"
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ── model select ──────────────────────────────────────────────────────────────

describe("model select", () => {
  it("re-renders with the chosen model so the header shows what the request uses", async () => {
    const { getByText, getByTestId } = renderApp()

    await act(async () => {
      fireEvent.click(getByText("change-model"))
    })

    expect(getByTestId("overlay")).toHaveAttribute("data-model", "qwen3")
  })
})

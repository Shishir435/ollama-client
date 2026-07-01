import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_CONTENT_EXTRACTION_CONFIG } from "@/lib/constants/config"
import type { ContentExtractionConfig } from "@/types"
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

vi.mock("@/lib/runtime-messages", () => ({
  sendRuntimeMessage: vi.fn().mockResolvedValue(undefined)
}))

// Stub SelectionActionsOverlay — exposes each callback as a named button
// so tests can trigger actions without depending on translations or icon layout.
vi.mock("../components/selection-actions-overlay", () => ({
  SelectionActionsOverlay: ({
    onRunAction,
    onCancel,
    onBack,
    onClose,
    onRetry,
    onRunCustom,
    onToggleMore,
    panelState,
    mode
  }: {
    onRunAction: (id: string) => void
    onCancel: () => void
    onBack: () => void
    onClose: () => void
    onRetry: () => void
    onRunCustom: () => void
    onToggleMore: () => void
    panelState: string
    mode: string
  }) => (
    <div data-testid="overlay" data-mode={mode} data-panel-state={panelState}>
      <button type="button" onClick={() => onRunAction("summarize")}>
        run-summarize
      </button>
      <button type="button" onClick={() => onRunAction("shorten")}>
        run-shorten
      </button>
      <button type="button" onClick={() => onRunAction("custom")}>
        run-custom
      </button>
      <button type="button" onClick={onCancel}>
        cancel
      </button>
      <button type="button" onClick={onBack}>
        back
      </button>
      <button type="button" onClick={onClose}>
        close
      </button>
      <button type="button" onClick={onRetry}>
        retry
      </button>
      <button type="button" onClick={onRunCustom}>
        run-custom-submit
      </button>
      <button type="button" onClick={onToggleMore}>
        toggle-more
      </button>
    </div>
  )
}))

// ── fixtures ──────────────────────────────────────────────────────────────────

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
  const modelsRef = {
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
  const onModelChange = vi.fn()
  const onClose = vi.fn()

  const result = render(
    <SelectionOverlayApp
      container={container}
      tooltipContainer={null}
      configRef={configRef}
      captureRef={captureRef}
      modelsRef={modelsRef}
      panelModelRef={panelModelRef}
      panelProviderIdRef={panelProviderIdRef}
      panelActiveRef={panelActiveRef}
      onModelChange={onModelChange}
      onClose={onClose}
    />
  )

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
  it("fetches models on mount when modelsRef is empty", async () => {
    await act(async () => {
      renderApp({ modelsPreloaded: false })
      vi.runAllTimers()
    })

    expect(contentSettings.loadAvailablePanelModels).toHaveBeenCalledOnce()
  })

  it("skips model fetch when modelsRef already has data", async () => {
    await act(async () => {
      renderApp({ modelsPreloaded: true })
      vi.runAllTimers()
    })

    expect(contentSettings.loadAvailablePanelModels).not.toHaveBeenCalled()
  })
})

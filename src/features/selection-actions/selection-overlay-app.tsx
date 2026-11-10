import type { PointerEvent as ReactPointerEvent } from "react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState
} from "react"
import type { SelectionActionId } from "@/application/selection-actions/types"
import { SelectionActionsOverlay } from "@/features/selection-actions/components/selection-actions-overlay"
import {
  copySelectionResult,
  insertBelowCapturedSelection,
  openSelectionResultInChat,
  replaceCapturedSelection
} from "@/features/selection-actions/content-result-actions"
import { loadAvailablePanelModels } from "@/features/selection-actions/content-settings"
import {
  startSelectionActionStream,
  stopSelectionStream
} from "@/features/selection-actions/content-stream"
import type {
  EditOutcome,
  SelectionCapture
} from "@/features/selection-actions/dom"
import {
  nudgeOverlay,
  placeSelectionOverlay,
  startOverlayDrag
} from "@/features/selection-actions/overlay-position"
import {
  createSelectionOverlayState,
  reduceSelectionOverlayState
} from "@/features/selection-actions/overlay-state"
import {
  type SelectionOverlayContextValue,
  type SelectionOverlayNotice,
  SelectionOverlayProvider
} from "@/features/selection-actions/selection-overlay-context"
import type { ContentExtractionConfig, ProviderModel } from "@/types"

interface OverlayAppProps {
  container: HTMLDivElement
  tooltipContainer: HTMLElement | ShadowRoot | null
  config: ContentExtractionConfig
  capture: SelectionCapture | null
  models: ProviderModel[]
  panelModel: string
  panelProviderId: string | undefined
  onPanelActiveChange: (active: boolean) => void
  onModelsLoaded: (models: ProviderModel[]) => void
  onModelChange: (model: string, providerId?: string) => void
  onClose: () => void
}

const COPIED_NOTICE_MS = 1500

/** Own capture-scoped output, page edits and streams; unmounting cancels pending model work. */
export function SelectionOverlayApp({
  container,
  tooltipContainer,
  config,
  capture,
  models,
  panelModel,
  panelProviderId,
  onPanelActiveChange,
  onModelsLoaded,
  onModelChange,
  onClose
}: OverlayAppProps) {
  const [state, dispatch] = useReducer(
    reduceSelectionOverlayState,
    undefined,
    createSelectionOverlayState
  )
  const stateRef = useRef(state)
  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])
  const streamPortRef = useRef<chrome.runtime.Port | null>(null)
  const [notice, setNotice] = useState<SelectionOverlayNotice | null>(null)
  const noticeTimerRef = useRef<number | undefined>(undefined)
  const [applied, setApplied] = useState(false)
  const undoRef = useRef<(() => boolean) | null>(null)
  const openingChatRef = useRef(false)
  const [isOpeningChat, setIsOpeningChat] = useState(false)
  const showNotice = useCallback((next: SelectionOverlayNotice | null) => {
    window.clearTimeout(noticeTimerRef.current)
    setNotice(next)
    if (next === "copied") {
      noticeTimerRef.current = window.setTimeout(
        () => setNotice(null),
        COPIED_NOTICE_MS
      )
    }
  }, [])
  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), [])

  /**
   * Refresh the cached list each time the toolbar expands so provider changes
   * made between selections are reflected in the model picker.
   */
  useEffect(() => {
    if (state.mode !== "panel") return

    let cancelled = false
    loadAvailablePanelModels()
      .then((availableModels) => {
        if (!cancelled && availableModels !== null) {
          onModelsLoaded(availableModels)
        }
      })
      .catch(() => {
        // Keep the last available list if model discovery temporarily fails.
      })

    return () => {
      cancelled = true
    }
  }, [state.mode, onModelsLoaded])

  // ── Cleanup stream on unmount ────────────────────────────────────────
  /** A start queued for the next tick must not open a port after unmount. */
  const startTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    return () => {
      window.clearTimeout(startTimerRef.current)
      streamPortRef.current = stopSelectionStream(streamPortRef.current)
    }
  }, [])

  // ── Sync panelActiveRef to content-script (outside React) ────────────
  useLayoutEffect(() => {
    onPanelActiveChange(state.mode === "panel")
  }, [state.mode, onPanelActiveChange])

  // ── Position overlay on first show ───────────────────────────────────

  useLayoutEffect(() => {
    if (state.isPinned) return

    if (!capture) return
    placeSelectionOverlay(container, capture.rect)
  }, [state.mode, state.isPinned, container, capture])

  useEffect(() => {
    const reposition = () => {
      if (stateRef.current.isPinned) {
        nudgeOverlay(container, 0, 0)
      } else if (capture) {
        placeSelectionOverlay(container, capture.rect)
      }
    }
    const observer = new ResizeObserver(reposition)
    observer.observe(container)
    window.addEventListener("resize", reposition)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", reposition)
    }
  }, [container, capture])

  // ── Handlers ─────────────────────────────────────────────────────────
  const scheduleStart = () => {
    window.clearTimeout(startTimerRef.current)
    startTimerRef.current = window.setTimeout(startStream, 0)
  }

  const runAction = (actionId: SelectionActionId) => {
    showNotice(null)
    dispatch({ type: "action.open", actionId })

    if (actionId !== "custom") {
      scheduleStart()
    }
  }

  const startStream = () => {
    if (!capture) return
    streamPortRef.current = stopSelectionStream(streamPortRef.current)
    streamPortRef.current = startSelectionActionStream({
      capture,
      state: stateRef.current,
      panelModel,
      panelProviderId,
      dispatch,
      onFinish: () => {
        streamPortRef.current = null
      }
    })
  }

  const stopStream = () => {
    streamPortRef.current = stopSelectionStream(streamPortRef.current)
  }

  const handleDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    startOverlayDrag(event, {
      container,
      markInteraction: () => {},
      onDragStart: () => dispatch({ type: "pin.enable" })
    })
  }

  const handleCopy = () => {
    void copySelectionResult(stateRef.current.resultText).then((copied) =>
      showNotice(copied ? "copied" : "copy_failed")
    )
  }

  /**
   * Apply and keep the panel open: the result stays visible beside a one-step
   * Undo, and a refused write (the text moved while the result streamed) leaves
   * Copy at hand instead of silently closing.
   */
  const applyToPage = (outcome: EditOutcome) => {
    if (outcome.applied) {
      undoRef.current = outcome.undo
      setApplied(true)
      showNotice("applied")
      return
    }
    showNotice(outcome.reason === "stale" ? "apply_stale" : "apply_failed")
  }

  const handleReplace = () => {
    if (undoRef.current) return
    applyToPage(replaceCapturedSelection(capture, stateRef.current.resultText))
  }

  const handleInsert = () => {
    if (undoRef.current) return
    applyToPage(
      insertBelowCapturedSelection(capture, stateRef.current.resultText)
    )
  }

  const handleUndo = () => {
    const undo = undoRef.current
    undoRef.current = null
    setApplied(false)
    showNotice(undo?.() ? "undone" : "undo_failed")
  }

  const handleNudge = (dx: number, dy: number) => {
    dispatch({ type: "pin.enable" })
    nudgeOverlay(container, dx, dy)
  }

  const handleOpenChat = () => {
    if (openingChatRef.current) return
    openingChatRef.current = true
    setIsOpeningChat(true)
    void openSelectionResultInChat(stateRef.current.resultText, capture)
      .then((didOpen) => {
        if (didOpen) onClose()
        else showNotice("open_chat_failed")
      })
      .finally(() => {
        openingChatRef.current = false
        setIsOpeningChat(false)
      })
  }

  const handleBack = () => {
    stopStream()
    dispatch({ type: "toolbar.back" })
  }

  const handleRetry = () => {
    showNotice(null)
    stopStream()
    scheduleStart()
  }

  const handleCancel = () => {
    stopStream()
    dispatch({ type: "panel.cancel" })
  }

  const handleRunCustom = () => {
    stopStream()
    scheduleStart()
  }

  const handleRefine = (instruction: string) => {
    if (
      stateRef.current.panelState !== "done" ||
      !instruction.trim() ||
      !stateRef.current.resultText.trim()
    )
      return
    showNotice(null)
    dispatch({ type: "refinement.start", instruction })
    scheduleStart()
  }

  // ── Derived props ────────────────────────────────────────────────────
  const enabledActionIds = (
    config.selectionActionsEnabledIds?.length
      ? config.selectionActionsEnabledIds
      : ["summarize", "explain", "custom"]
  ) as SelectionActionId[]

  const hasResult = state.panelState === "done" && !!state.resultText.trim()
  const canReplace = hasResult && !applied && (capture?.canReplace ?? false)
  const canInsert = hasResult && !applied && (capture?.canInsert ?? false)

  // ── Render ───────────────────────────────────────────────────────────

  /**
   * The overlay tree reads this instead of receiving 32 forwarded props. Not
   * memoized on purpose: `resultText` changes on every streamed token, so the
   * tree re-renders regardless and a stable value would only hide that.
   */
  const overlay: SelectionOverlayContextValue = {
    mode: state.mode,
    panelState: state.panelState,
    currentAction: state.currentAction,
    enabledActionIds,
    resultText: state.resultText,
    originalText: capture?.text ?? "",
    errorText: state.errorText,
    errorKey: state.errorKey,
    notice,
    canUndo: applied,
    canRestoreResult:
      state.panelState === "error" && !!state.completedResult.trim(),
    isOpeningChat,
    isThinking: state.isThinking,
    thinkingText: state.thinkingText,
    availableModels: models,
    panelModel,
    panelProviderId,
    canReplace,
    canInsert,
    isPinned: state.isPinned,
    customInstruction: state.customInstruction,
    tooltipContainer,
    actions: {
      /**
       * Opening an action and switching the panel's action select are the same
       * operation — both run the action — so this replaces the previous
       * onRunAction / onActionChange pair that pointed at one function.
       */
      runAction,
      changeModel: onModelChange,
      togglePin: () => dispatch({ type: "pin.toggle" }),
      copy: handleCopy,
      replace: handleReplace,
      insertBelow: handleInsert,
      openChat: handleOpenChat,
      retry: handleRetry,
      cancel: handleCancel,
      back: handleBack,
      /** Closing unmounts this tree (the content script's `hide`), whose cleanup stops the stream. */
      close: onClose,
      setCustomInstruction: (value) => dispatch({ type: "custom.set", value }),
      runCustom: handleRunCustom,
      refine: handleRefine,
      startDrag: handleDragStart,
      nudge: handleNudge,
      undo: handleUndo
    }
  }

  return (
    <SelectionOverlayProvider value={overlay}>
      <SelectionActionsOverlay />
    </SelectionOverlayProvider>
  )
}

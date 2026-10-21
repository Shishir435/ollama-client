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
import type { SelectionCapture } from "@/features/selection-actions/dom"
import {
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
import { MESSAGE_KEYS } from "@/lib/constants"
import { sendRuntimeMessage } from "@/lib/retained-runtime-messages"
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
  setContainerVisible: (visible: boolean) => void
  onModelChange: (model: string, providerId?: string) => void
  onClose: () => void
}

const COPIED_NOTICE_MS = 1500

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
  setContainerVisible,
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
  const placedRef = useRef(false)
  const [notice, setNotice] = useState<SelectionOverlayNotice | null>(null)
  const noticeTimerRef = useRef<number | undefined>(undefined)
  /**
   * The model select writes through to `panelModelRef`, which React cannot
   * see; without a re-render the controlled select snaps back to the old
   * value while the next request already uses the new one.
   */
  const [, bumpModelVersion] = useReducer((n: number) => n + 1, 0)

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

  // Refresh the cached list each time the toolbar expands so provider changes
  // made between selections are reflected in the model picker.
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
  const isHidden = state.panelState === "idle" && state.mode !== "toolbar"

  useLayoutEffect(() => {
    if (isHidden || state.isPinned) return

    if (!placedRef.current) {
      placedRef.current = true
      if (!capture) return

      placeSelectionOverlay(container, capture.rect)
    }
  }, [isHidden, state.isPinned, container, capture, setContainerVisible])

  // ── Show/hide container ──────────────────────────────────────────────
  useEffect(() => {
    if (state.panelState === "idle" && state.mode !== "toolbar") {
      setContainerVisible(false)
      placedRef.current = false
    }
  }, [state.panelState, state.mode, setContainerVisible])

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
      render: () => {},
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
      onDragStart: () => dispatch({ type: "pin.enable" }),
      onDragEnd: () => {}
    })
  }

  const handleCopy = () => {
    void copySelectionResult(stateRef.current.resultText).then((copied) =>
      showNotice(copied ? "copied" : "copy_failed")
    )
  }

  const handleReplace = () => {
    if (
      capture &&
      replaceCapturedSelection(capture, stateRef.current.resultText)
    ) {
      onClose()
      return
    }
    showNotice("apply_failed")
  }

  const handleInsert = () => {
    if (
      capture &&
      insertBelowCapturedSelection(capture, stateRef.current.resultText)
    ) {
      onClose()
      return
    }
    showNotice("apply_failed")
  }

  const handleModelChange = (model: string, providerId?: string) => {
    onModelChange(model, providerId)
    bumpModelVersion()
  }

  const handleOpenChat = () => {
    const result = stateRef.current.resultText.trim()

    if (result) {
      void openSelectionResultInChat(result, capture).then((didOpen) => {
        if (didOpen) onClose()
      })
      return
    }

    const text = capture?.text.trim()
    if (!text) return
    void sendRuntimeMessage(MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT, {
      payload: text
    })
    window.getSelection()?.removeAllRanges()
    onClose()
  }

  const handleBack = () => {
    stopStream()
    dispatch({ type: "toolbar.back" })
  }

  const handleRetry = () => {
    showNotice(null)
    stopStream()
    dispatch({ type: "panel.cancel" })
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

  // ── Derived props ────────────────────────────────────────────────────
  const enabledActionIds = (
    config.selectionActionsEnabledIds?.length
      ? config.selectionActionsEnabledIds
      : ["summarize", "explain", "custom"]
  ) as SelectionActionId[]

  const hasResult = state.panelState === "done" && !!state.resultText.trim()
  const canReplace = hasResult && (capture?.canReplace ?? false)
  const canInsert = hasResult && (capture?.canInsert ?? false)

  // ── Render ───────────────────────────────────────────────────────────
  if (state.panelState === "idle" && state.mode !== "toolbar") return null

  // The overlay tree reads this instead of receiving 32 forwarded props. Not
  // memoized on purpose: `resultText` changes on every streamed token, so the
  // tree re-renders regardless and a stable value would only hide that.
  const overlay: SelectionOverlayContextValue = {
    mode: state.mode,
    panelState: state.panelState,
    currentAction: state.currentAction,
    enabledActionIds,
    isMoreMenuOpen: state.isMoreMenuOpen,
    resultText: state.resultText,
    errorText: state.errorText,
    errorKey: state.errorKey,
    notice,
    isThinking: state.isThinking,
    thinkingText: state.thinkingText,
    availableModels: models,
    panelModel,
    canReplace,
    canInsert,
    isPinned: state.isPinned,
    customInstruction: state.customInstruction,
    tooltipContainer,
    actions: {
      // Opening an action and switching the panel's action select are the same
      // operation — both run the action — so this replaces the previous
      // onRunAction / onActionChange pair that pointed at one function.
      runAction,
      changeModel: handleModelChange,
      toggleMore: () => dispatch({ type: "menu.toggle" }),
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
      startDrag: handleDragStart
    }
  }

  return (
    <SelectionOverlayProvider value={overlay}>
      <SelectionActionsOverlay />
    </SelectionOverlayProvider>
  )
}

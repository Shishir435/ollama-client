import type { PointerEvent as ReactPointerEvent } from "react"
import { useEffect, useLayoutEffect, useReducer, useRef } from "react"
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
import type { SelectionActionId } from "@/features/selection-actions/types"
import { MESSAGE_KEYS } from "@/lib/constants"
import { sendRuntimeMessage } from "@/lib/runtime-messages"
import type { ContentExtractionConfig, ProviderModel } from "@/types"

interface OverlayAppProps {
  container: HTMLDivElement
  tooltipContainer: HTMLElement | ShadowRoot | null
  configRef: { current: ContentExtractionConfig }
  captureRef: { current: SelectionCapture | null }
  modelsRef: { current: ProviderModel[] }
  panelModelRef: { current: string }
  panelProviderIdRef: { current: string | undefined }
  panelActiveRef: { current: boolean }
  onModelChange: (model: string, providerId?: string) => void
  onClose: () => void
}

export function SelectionOverlayApp({
  container,
  tooltipContainer,
  configRef,
  captureRef,
  modelsRef,
  panelModelRef,
  panelProviderIdRef,
  panelActiveRef,
  onModelChange,
  onClose
}: OverlayAppProps) {
  const [state, dispatch] = useReducer(
    reduceSelectionOverlayState,
    null,
    createSelectionOverlayState
  )
  const stateRef = useRef(state)
  stateRef.current = state
  const streamPortRef = useRef<chrome.runtime.Port | null>(null)
  // Init from modelsRef so remounts (selectionKey++) don't re-fetch already-loaded models
  const modelsLoadedRef = useRef(modelsRef.current.length > 0)
  const placedRef = useRef(false)

  // ── Fetch models once ────────────────────────────────────────────────
  useEffect(() => {
    if (!modelsLoadedRef.current) {
      loadAvailablePanelModels()
        .then((models) => {
          modelsRef.current = models
          modelsLoadedRef.current = true
        })
        .catch(() => {})
    }
  }, [modelsRef])

  // ── Cleanup stream on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      streamPortRef.current = stopSelectionStream(streamPortRef.current)
    }
  }, [])

  // ── Sync panelActiveRef to content-script (outside React) ────────────
  useLayoutEffect(() => {
    panelActiveRef.current = state.mode === "panel"
  }, [state.mode, panelActiveRef])

  // ── Position overlay on first show ───────────────────────────────────
  const isHidden = state.panelState === "idle" && state.mode !== "toolbar"

  useLayoutEffect(() => {
    if (isHidden || state.isPinned) return

    if (!placedRef.current) {
      placedRef.current = true
      const capture = captureRef.current
      if (!capture) return

      container.style.display = "block"
      placeSelectionOverlay(
        container,
        capture.rect.bottom + 10,
        capture.rect.left + capture.rect.width / 2
      )
    }
  }, [isHidden, state.isPinned, container, captureRef])

  // ── Show/hide container ──────────────────────────────────────────────
  useEffect(() => {
    if (state.panelState === "idle" && state.mode !== "toolbar") {
      container.style.display = "none"
      placedRef.current = false
    }
  }, [state.panelState, state.mode, container])

  // ── Handlers ─────────────────────────────────────────────────────────
  const runAction = (actionId: SelectionActionId) => {
    dispatch({ type: "action.open", actionId })

    if (actionId !== "custom") {
      setTimeout(startStream, 0)
    }
  }

  const startStream = () => {
    const capture = captureRef.current
    if (!capture) return
    streamPortRef.current = stopSelectionStream(streamPortRef.current)
    streamPortRef.current = startSelectionActionStream({
      capture,
      state: stateRef.current,
      panelModel: panelModelRef.current,
      panelProviderId: panelProviderIdRef.current,
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
    void copySelectionResult(stateRef.current.resultText)
  }

  const handleReplace = () => {
    const capture = captureRef.current
    if (
      capture &&
      replaceCapturedSelection(capture, stateRef.current.resultText)
    ) {
      onClose()
    }
  }

  const handleInsert = () => {
    const capture = captureRef.current
    if (
      capture &&
      insertBelowCapturedSelection(capture, stateRef.current.resultText)
    ) {
      onClose()
    }
  }

  const handleOpenChat = () => {
    const result = stateRef.current.resultText.trim()
    const capture = captureRef.current

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
    stopStream()
    dispatch({ type: "panel.cancel" })
    setTimeout(startStream, 0)
  }

  const handleCancel = () => {
    stopStream()
    dispatch({ type: "panel.cancel" })
  }

  const handleRunCustom = () => {
    stopStream()
    setTimeout(startStream, 0)
  }

  // ── Derived props ────────────────────────────────────────────────────
  const enabledActionIds = (
    configRef.current.selectionActionsEnabledIds?.length
      ? configRef.current.selectionActionsEnabledIds
      : ["summarize", "explain", "custom"]
  ) as SelectionActionId[]

  const hasResult = state.panelState === "done" && !!state.resultText.trim()
  const canReplace = hasResult && (captureRef.current?.canReplace ?? false)
  const canInsert = hasResult && (captureRef.current?.canInsert ?? false)

  // ── Render ───────────────────────────────────────────────────────────
  if (state.panelState === "idle" && state.mode !== "toolbar") return null

  return (
    <SelectionActionsOverlay
      mode={state.mode}
      panelState={state.panelState}
      currentAction={state.currentAction}
      enabledActionIds={enabledActionIds}
      isMoreMenuOpen={state.isMoreMenuOpen}
      resultText={state.resultText}
      errorText={state.errorText}
      isThinking={state.isThinking}
      thinkingText={state.thinkingText}
      availableModels={modelsRef.current}
      panelModel={panelModelRef.current}
      onModelChange={onModelChange}
      canReplace={canReplace}
      canInsert={canInsert}
      tooltipContainer={tooltipContainer}
      isPinned={state.isPinned}
      customInstruction={state.customInstruction}
      onRunAction={runAction}
      onActionChange={runAction}
      onBack={handleBack}
      onToggleMore={() => dispatch({ type: "menu.toggle" })}
      onCopy={handleCopy}
      onReplace={handleReplace}
      onInsertBelow={handleInsert}
      onOpenChat={handleOpenChat}
      onRetry={handleRetry}
      onCancel={handleCancel}
      onClose={onClose}
      onTogglePin={() => dispatch({ type: "pin.toggle" })}
      onCustomInstructionChange={(value) =>
        dispatch({ type: "custom.set", value })
      }
      onRunCustom={handleRunCustom}
      onDragStart={handleDragStart}
    />
  )
}

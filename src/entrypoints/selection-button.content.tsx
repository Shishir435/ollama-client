import type { PointerEvent as ReactPointerEvent } from "react"
import { flushSync } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { defineContentScript } from "wxt/utils/define-content-script"
import { isEmbeddingModel } from "@/features/model/lib/model-utils"
import { SelectionActionsOverlay } from "@/features/selection-actions/components/selection-actions-overlay"
import {
  getSelectionCapture,
  insertAfterContentEditableSelection,
  insertAfterEditableSelection,
  replaceContentEditableSelection,
  replaceEditableSelection,
  type SelectionCapture,
  toSelectionPayload
} from "@/features/selection-actions/dom"
import type {
  SelectionActionId,
  SelectionActionRequest
} from "@/features/selection-actions/types"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { isSelectedModelRef } from "@/lib/providers/selected-model"
import {
  makeThinkingParserState,
  splitThinkingDelta,
  type ThinkingParserState
} from "@/lib/thinking-parser"
import type {
  ChromeMessage,
  ChromeResponse,
  ContentExtractionConfig,
  ProviderModel
} from "@/types"
import appStyles from "../globals.css?inline"

type PanelState = "idle" | "streaming" | "done" | "error"
type OverlayMode = "toolbar" | "panel"

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max))

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  cssInjectionMode: "ui",
  async main(ctx) {
    let container: HTMLDivElement | null = null
    let tooltipContainer: HTMLElement | ShadowRoot | null = null
    let root: Root | null = null
    let config: ContentExtractionConfig = DEFAULT_CONTENT_EXTRACTION_CONFIG
    let currentCapture: SelectionCapture | null = null
    let currentAction: SelectionActionId = "summarize"
    let overlayMode: OverlayMode = "toolbar"
    let resultText = ""
    let errorText = ""
    let panelState: PanelState = "idle"
    let streamPort: chrome.runtime.Port | null = null
    let isThinking = false
    let thinkingText = ""
    let thinkingState: ThinkingParserState = makeThinkingParserState()
    let availableModels: ProviderModel[] = []
    let panelModel = ""
    let panelProviderId: string | undefined
    let modelsLoadedOnce = false
    let isMoreMenuOpen = false
    let isPinned = false
    let customInstruction = ""
    let overlayInteractingUntil = 0
    const appIconUrl = chrome.runtime.getURL("assets/icon-32.png")

    const markOverlayInteraction = () => {
      overlayInteractingUntil = Date.now() + 900
    }

    const syncPanelModel = async () => {
      const ref = await plasmoGlobalStorage.get<unknown>(
        STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF
      )
      const fallback = await plasmoGlobalStorage.get<string>(
        STORAGE_KEYS.PROVIDER.SELECTED_MODEL
      )
      if (!panelModel) {
        if (isSelectedModelRef(ref)) {
          panelModel = ref.modelId
          panelProviderId = ref.providerId
        } else if (fallback) {
          panelModel = fallback
          panelProviderId = undefined
        }
      }
    }

    const fetchModels = async () => {
      if (modelsLoadedOnce) return
      try {
        const resp = (await chrome.runtime.sendMessage({
          type: MESSAGE_KEYS.PROVIDER.GET_MODELS
        })) as ChromeResponse
        if (
          resp?.success &&
          resp.data &&
          typeof resp.data === "object" &&
          "models" in resp.data
        ) {
          const allModels = (resp.data as { models: ProviderModel[] }).models
          availableModels = allModels.filter(
            (m) => !isEmbeddingModel(m.model, m.details?.families ?? [])
          )
          modelsLoadedOnce = true
          renderOverlay(false)
        }
      } catch {
        // background not ready yet
      }
    }

    const ui = await createShadowRootUi(ctx, {
      name: "provider-selection-actions",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (uiContainer) => {
        container = document.createElement("div")
        container.id = "selection-actions-root"
        container.style.display = "none"
        container.style.position = "fixed"
        container.style.zIndex = "2147483647"
        tooltipContainer = container

        const style = document.createElement("style")
        style.textContent = `
          ${appStyles}

          :host {
            --radius: 0.625rem;
          }
          #selection-actions-root {
            --sa-radius-lg: var(--radius-lg, var(--radius, 0.625rem));
            --sa-radius-md: var(--radius-md, calc(var(--radius, 0.625rem) - 2px));
            --sa-bg: var(--background);
            --sa-fg: var(--foreground);
            --sa-muted: var(--muted-foreground);
            --sa-border: var(--border);
            --sa-hover: var(--muted);
            --sa-accent: var(--primary);
            --sa-danger: var(--destructive);
            --sa-shadow: 0 4px 24px oklch(0.141 0.005 285.823 / 0.18);
          }
          #selection-actions-root.dark {
            --sa-shadow: 0 4px 24px oklch(0 0 0 / 0.36);
          }
          [data-slot="tooltip-content"] {
            box-sizing: border-box !important;
            border-radius: var(--radius-md, calc(var(--radius, 0.625rem) - 2px)) !important;
            background-color: var(--foreground) !important;
            color: var(--background) !important;
            font-size: 0.75rem !important;
            line-height: 1.4 !important;
            font-family: var(--font-sans, system-ui, sans-serif) !important;
            padding: 0.375rem 0.75rem !important;
            max-width: 18rem !important;
            box-shadow: 0 4px 6px -1px oklch(0 0 0 / 0.12) !important;
          }
          .dark [data-slot="tooltip-content"] {
            background-color: var(--card) !important;
            color: var(--card-foreground) !important;
            border: 1px solid var(--border) !important;
            box-shadow: 0 4px 6px -1px oklch(0 0 0 / 0.28) !important;
          }
          [data-slot="tooltip-arrow"] {
            display: none !important;
          }
          .sa-toolbar {
            box-sizing: border-box;
            max-width: calc(100vw - 16px);
            background: var(--sa-bg);
            color: var(--sa-fg);
            border: 1px solid var(--sa-border);
            border-radius: var(--sa-radius-lg);
            box-shadow: var(--sa-shadow);
            font-family: var(--font-sans, system-ui, sans-serif);
            font-size: 0.75rem;
            line-height: 1.4;
          }
          .sa-toolbar {
            width: fit-content;
            max-width: calc(100vw - 16px);
            padding: 5px;
            position: relative;
          }
          .sa-toolbar-strip {
            display: flex;
            align-items: center;
            gap: 4px;
            max-width: calc(100vw - 28px);
            overflow-x: auto;
            overflow-y: hidden;
            overscroll-behavior: contain;
            scrollbar-width: none;
          }
          .sa-toolbar-strip::-webkit-scrollbar {
            display: none;
          }
          .sa-button,
          .sa-input {
            box-sizing: border-box;
            height: var(--control-height-sm, 1.75rem);
            border: 1px solid transparent;
            border-radius: var(--sa-radius-md);
            background: transparent;
            color: var(--sa-fg);
            font: inherit;
          }
          .sa-button {
            display: inline-flex;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 0 0.75rem;
            cursor: pointer;
            white-space: nowrap;
            transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
          }
          .sa-button:hover:not(:disabled) {
            background: var(--sa-hover);
          }
          .sa-button:focus-visible {
            outline: 2px solid var(--ring);
            outline-offset: 1px;
          }
          .sa-button.primary {
            background: var(--accent);
            color: var(--accent-foreground);
            font-weight: 600;
          }
          .sa-toolbar .sa-button {
            width: var(--control-height-sm, 1.75rem);
            height: var(--control-height-sm, 1.75rem);
            padding: 0;
          }
          .sa-toolbar .sa-button.primary {
            width: var(--control-height-sm, 1.75rem);
            min-width: var(--control-height-sm, 1.75rem);
            padding: 0;
          }
          .sa-toolbar .sa-label {
            display: none;
          }
          .sa-button.outline {
            border-color: var(--sa-border);
            background: var(--sa-bg);
          }
          .sa-button.fill {
            background: var(--primary);
            color: var(--primary-foreground);
            border-color: var(--primary);
          }
          .sa-button.danger {
            color: var(--sa-danger);
          }
          .sa-button:disabled {
            cursor: not-allowed;
            opacity: 0.45;
          }
          .sa-button svg,
          .sa-drag-handle svg {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          /* Card overrides for the panel */
          .sa-panel-card {
            width: min(470px, calc(100vw - 16px));
            gap: 0;
            padding: 0;
            box-shadow: var(--sa-shadow);
            font-family: var(--font-sans, system-ui, sans-serif);
            font-size: 0.75rem;
            line-height: 1.4;
          }
          .sa-card-header {
            padding: 14px 16px 12px;
            border-bottom: 1px solid var(--sa-border);
            gap: 0;
            display: block;
          }
          .sa-card-content {
            padding: 12px 16px 4px;
          }
          .sa-card-footer {
            padding: 0 16px 14px;
          }
          /* Panel header */
          .sa-panel-header {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .sa-header-actions {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-shrink: 0;
          }
          .sa-title-row {
            display: flex;
            align-items: baseline;
            gap: 8px;
            flex: 1;
            min-width: 0;
            overflow: hidden;
          }
          .sa-title {
            font-size: 15px;
            line-height: 1.25;
            font-weight: 700;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex-shrink: 0;
            max-width: 220px;
          }
          .sa-drag-handle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1.5rem;
            height: var(--control-height-sm, 1.75rem);
            color: var(--sa-muted);
            cursor: grab;
            touch-action: none;
            flex-shrink: 0;
          }
          .sa-drag-handle:active {
            cursor: grabbing;
          }
          .sa-model-inline {
            appearance: none;
            -webkit-appearance: none;
            border: none;
            background: transparent;
            color: var(--sa-muted);
            font: inherit;
            font-size: 0.75rem;
            cursor: pointer;
            padding: 0;
            padding-right: 14px;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 0 center;
            background-size: 10px;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .sa-model-inline:focus {
            outline: none;
          }
          .sa-model-name {
            font-size: 0.75rem;
            color: var(--sa-muted);
          }
          .sa-result {
            min-height: 96px;
            max-height: 240px;
            overflow: auto;
            padding: 10px 4px;
            border: 0;
            background: transparent;
            color: var(--sa-fg);
            font-size: 15px;
            line-height: 1.48;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          .sa-error {
            color: var(--sa-danger);
          }
          .sa-custom-row {
            display: flex;
            gap: 6px;
            margin-bottom: 8px;
          }
          .sa-input {
            width: 100%;
            min-width: 0;
            padding: 0 0.5rem;
            border-color: var(--input, var(--sa-border));
            background: color-mix(in oklch, var(--input, var(--sa-border)) 20%, transparent);
          }
          .sa-input:focus-visible,
          .sa-input:focus {
            outline: none;
            border-color: var(--ring);
            box-shadow: 0 0 0 2px color-mix(in oklch, var(--ring) 30%, transparent);
          }
          .sa-panel-actions {
            flex-wrap: nowrap;
            justify-content: space-between;
            gap: 8px;
            margin-top: 14px;
            overflow-x: auto;
            scrollbar-width: none;
          }
          .sa-panel-actions::-webkit-scrollbar {
            display: none;
          }
          .sa-action-group {
            display: flex;
            flex: 0 0 auto;
            flex-wrap: nowrap;
            gap: 8px;
          }
          .apply-group {
            margin-left: auto;
          }
          .sa-panel-actions .sa-button {
            min-width: 2.625rem;
            height: var(--control-height-sm, 1.75rem);
            padding: 0 0.625rem;
          }
          .sa-panel-actions .icon-only {
            width: 2.625rem;
            padding: 0;
          }
          .sa-muted {
            color: var(--sa-muted);
          }
          .sa-menu {
            position: absolute;
            top: calc(100% + 8px);
            right: 6px;
            width: min(220px, calc(100vw - 28px));
            padding: 5px;
            background: var(--sa-bg);
            color: var(--sa-fg);
            border: 1px solid var(--sa-border);
            border-radius: var(--sa-radius-lg);
            box-shadow: var(--sa-shadow);
            z-index: 1;
          }
          .sa-menu-item {
            width: 100% !important;
            height: var(--control-height-sm, 1.75rem);
            padding: 0 0.625rem !important;
            justify-content: flex-start;
            text-align: left;
          }
          .sa-thinking-section {
            border: 1px solid var(--sa-border);
            border-radius: var(--sa-radius-md);
            margin-bottom: 8px;
            overflow: hidden;
          }
          .sa-thinking-header {
            display: flex;
            align-items: center;
            gap: 6px;
            width: 100%;
            padding: 5px 8px;
            background: var(--sa-hover);
            color: var(--sa-muted);
            font: inherit;
            font-size: 0.6875rem;
            text-align: left;
            cursor: pointer;
            border: none;
            user-select: none;
          }
          .sa-thinking-header:hover {
            background: color-mix(in oklch, var(--sa-border) 60%, var(--sa-hover));
          }
          .sa-thinking-label {
            flex: 1;
            min-width: 0;
          }
          .sa-thinking-chevron {
            font-size: 0.5rem;
            opacity: 0.6;
          }
          .sa-thinking-chevron-end {
            margin-left: auto;
          }
          @keyframes sa-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.4; transform: scale(0.85); }
          }
          .sa-thinking-pulse {
            display: inline-block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--sa-accent);
            flex-shrink: 0;
            animation: sa-pulse 1.2s ease-in-out infinite;
          }
          .sa-thinking-body {
            max-height: 140px;
            overflow-y: auto;
            padding: 8px 10px;
            font-size: 0.6875rem;
            color: var(--sa-muted);
            line-height: 1.5;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            background: color-mix(in oklch, var(--sa-hover) 50%, transparent);
            border-top: 1px solid var(--sa-border);
          }
        `
        uiContainer.append(style)
        uiContainer.append(container)
        root = createRoot(container)
        container.addEventListener("pointerdown", markOverlayInteraction, true)
        container.addEventListener("mousedown", markOverlayInteraction, true)
        container.addEventListener("click", markOverlayInteraction, true)
        container.addEventListener("keydown", markOverlayInteraction, true)
        container.addEventListener("input", markOverlayInteraction, true)
        container.addEventListener("focusin", markOverlayInteraction, true)
        return container
      }
    })

    const updateConfig = async () => {
      const stored = await plasmoGlobalStorage.get<ContentExtractionConfig>(
        STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG
      )
      config = {
        ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
        ...(stored ?? {})
      }
    }

    const enabledActionIds = () =>
      (config.selectionActionsEnabledIds?.length
        ? config.selectionActionsEnabledIds
        : DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsEnabledIds) as SelectionActionId[]

    const getSelectionAnchorLeft = (capture: SelectionCapture) =>
      capture.rect.left + capture.rect.width / 2

    const place = (top: number, anchorLeft: number) => {
      if (!container) return
      container.style.display = "block"
      container.style.visibility = "hidden"

      const viewportMargin = 8
      const width = container.offsetWidth
      const height = container.offsetHeight
      const maxLeft = window.innerWidth - width - viewportMargin
      const maxTop = window.innerHeight - height - viewportMargin
      const desiredLeft = anchorLeft - width / 2

      container.style.top = `${clamp(top, viewportMargin, maxTop)}px`
      container.style.left = `${clamp(desiredLeft, viewportMargin, maxLeft)}px`
      container.style.visibility = "visible"
    }

    const renderOverlay = (shouldPlace = true) => {
      if (!root || !container || !currentCapture) return
      const hasResult = panelState === "done" && !!resultText.trim()
      const canReplace = hasResult && currentCapture.canReplace
      const canInsert = hasResult && currentCapture.canInsert

      flushSync(() => {
        root?.render(
          <SelectionActionsOverlay
            mode={overlayMode}
            panelState={panelState}
            appIconUrl={appIconUrl}
            currentAction={currentAction}
            enabledActionIds={enabledActionIds()}
            isMoreMenuOpen={isMoreMenuOpen}
            resultText={resultText}
            errorText={errorText}
            isThinking={isThinking}
            thinkingText={thinkingText}
            availableModels={availableModels}
            panelModel={panelModel}
            onModelChange={(model, providerId) => {
              panelModel = model
              panelProviderId = providerId
              renderOverlay(false)
            }}
            canReplace={canReplace}
            canInsert={canInsert}
            tooltipContainer={tooltipContainer}
            isPinned={isPinned}
            customInstruction={customInstruction}
            onRunAction={runAction}
            onToggleMore={() => {
              markOverlayInteraction()
              isMoreMenuOpen = !isMoreMenuOpen
              renderOverlay()
            }}
            onCopy={() => void copyResult()}
            onReplace={replaceSelection}
            onInsertBelow={insertBelow}
            onOpenChat={() => void openInChat()}
            onRetry={() => void startAction()}
            onCancel={stopStream}
            onClose={hide}
            onTogglePin={() => {
              markOverlayInteraction()
              isPinned = !isPinned
              renderOverlay(false)
            }}
            onCustomInstructionChange={(value) => {
              markOverlayInteraction()
              customInstruction = value
              renderOverlay(false)
            }}
            onRunCustom={() => void startAction()}
            onDragStart={handleDragStart}
          />
        )
      })

      if (shouldPlace && !isPinned) {
        place(
          currentCapture.rect.bottom + 10,
          getSelectionAnchorLeft(currentCapture)
        )
      }
    }

    const stopStream = () => {
      if (!streamPort) return
      streamPort.postMessage({
        type: MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION
      })
      streamPort.disconnect()
      streamPort = null
    }

    const hide = () => {
      stopStream()
      root?.render(null)
      if (container) container.style.display = "none"
      overlayMode = "toolbar"
      panelState = "idle"
      resultText = ""
      errorText = ""
      isThinking = false
      thinkingText = ""
      thinkingState = makeThinkingParserState()
      customInstruction = ""
      isMoreMenuOpen = false
      isPinned = false
    }

    const openInChat = async () => {
      const text = resultText.trim() || currentCapture?.text.trim()
      if (!text) return
      await chrome.runtime.sendMessage({
        type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
        payload: text
      })
      hide()
      window.getSelection()?.removeAllRanges()
    }

    const copyResult = async () => {
      const text = resultText.trim()
      if (!text) return
      await navigator.clipboard.writeText(text)
    }

    const runAction = (actionId: SelectionActionId) => {
      markOverlayInteraction()
      currentAction = actionId
      isMoreMenuOpen = false
      overlayMode = "panel"
      resultText = ""
      errorText = ""
      void fetchModels()

      if (actionId === "custom") {
        panelState = "idle"
        renderOverlay()
        return
      }

      void startAction()
    }

    const replaceSelection = () => {
      if (!currentCapture || !resultText.trim()) return
      const text = resultText.trim()
      let changed = false

      if (currentCapture.editableTarget) {
        currentCapture.editableTarget.focus()
        changed = replaceEditableSelection(
          currentCapture.editableTarget,
          text,
          currentCapture.selectionStart,
          currentCapture.selectionEnd
        )
      } else if (currentCapture.range && currentCapture.contentEditableRoot) {
        changed = replaceContentEditableSelection(
          currentCapture.range,
          currentCapture.contentEditableRoot,
          text
        )
      }

      if (changed) hide()
    }

    const insertBelow = () => {
      if (!currentCapture || !resultText.trim()) return
      const text = resultText.trim()
      let changed = false

      if (currentCapture.editableTarget) {
        currentCapture.editableTarget.focus()
        changed = insertAfterEditableSelection(
          currentCapture.editableTarget,
          text,
          currentCapture.selectionEnd
        )
      } else if (currentCapture.range && currentCapture.contentEditableRoot) {
        changed = insertAfterContentEditableSelection(
          currentCapture.range,
          currentCapture.contentEditableRoot,
          text
        )
      }

      if (changed) hide()
    }

    const startAction = async () => {
      if (!currentCapture) return
      stopStream()
      resultText = ""
      errorText = ""
      isThinking = false
      thinkingText = ""
      thinkingState = makeThinkingParserState()
      panelState = "streaming"
      overlayMode = "panel"
      renderOverlay()

      const request: SelectionActionRequest = {
        actionId: currentAction,
        selection: toSelectionPayload(currentCapture),
        customInstruction,
        ...(panelModel && { model: panelModel }),
        ...(panelProviderId && { providerId: panelProviderId })
      }

      streamPort = chrome.runtime.connect({
        name: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION
      })

      streamPort.onMessage.addListener((raw) => {
        const message = raw as ChromeMessage
        if (message.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK) {
          const payload = message.payload as
            | {
                delta?: string
                thinkingDelta?: string
              }
            | undefined
          const rawDelta = payload?.delta ?? ""
          const rawThinkingDelta = payload?.thinkingDelta ?? ""
          const { visible, thinking: inlineThinking } = splitThinkingDelta(
            rawDelta,
            thinkingState
          )
          resultText += visible
          thinkingText += rawThinkingDelta + inlineThinking
          isThinking =
            !resultText &&
            (rawThinkingDelta.length > 0 || thinkingState.inThinking)
          renderOverlay(false)
        }
        if (message.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE) {
          panelState = "done"
          streamPort?.disconnect()
          streamPort = null
          renderOverlay(false)
        }
        if (message.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR) {
          panelState = "error"
          errorText =
            message.error?.message ?? "Selection Action failed. Try again."
          streamPort?.disconnect()
          streamPort = null
          renderOverlay(false)
        }
      })

      streamPort.postMessage({
        type: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
        payload: request
      })
    }

    const handleDragStart = (event: ReactPointerEvent<HTMLElement>) => {
      if (!container) return
      event.preventDefault()
      event.stopPropagation()
      markOverlayInteraction()
      isPinned = true

      const rect = container.getBoundingClientRect()
      const offsetX = event.clientX - rect.left
      const offsetY = event.clientY - rect.top

      const handleMove = (moveEvent: PointerEvent) => {
        if (!container) return
        const margin = 8
        const width = container.offsetWidth
        const height = container.offsetHeight
        container.style.left = `${clamp(
          moveEvent.clientX - offsetX,
          margin,
          window.innerWidth - width - margin
        )}px`
        container.style.top = `${clamp(
          moveEvent.clientY - offsetY,
          margin,
          window.innerHeight - height - margin
        )}px`
      }

      const handleUp = () => {
        document.removeEventListener("pointermove", handleMove, true)
        document.removeEventListener("pointerup", handleUp, true)
        renderOverlay(false)
      }

      document.addEventListener("pointermove", handleMove, true)
      document.addEventListener("pointerup", handleUp, true)
      renderOverlay(false)
    }

    const showForSelection = (capture: SelectionCapture) => {
      currentCapture = {
        ...capture,
        range: capture.range?.cloneRange()
      }
      if (!enabledActionIds().includes(currentAction)) {
        currentAction = enabledActionIds()[0] ?? "summarize"
      }
      overlayMode = "toolbar"
      panelState = "idle"
      resultText = ""
      errorText = ""
      customInstruction = ""
      isMoreMenuOpen = false
      renderOverlay()
    }

    const handleSelectionChange = () => {
      if (Date.now() < overlayInteractingUntil) return
      if (isPinned || overlayMode === "panel") return
      if (!config.showSelectionButton || !config.selectionActionsEnabled) {
        hide()
        return
      }

      const capture = getSelectionCapture()
      const minChars =
        config.selectionActionsMinChars ??
        DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsMinChars
      if (!capture || capture.text.length < minChars) {
        hide()
        return
      }
      showForSelection(capture)
    }

    const queueSelectionCheck = () => {
      window.setTimeout(handleSelectionChange, 80)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide()
    }

    await Promise.all([updateConfig(), syncPanelModel()])
    ui.mount()

    const applyTheme = async () => {
      if (!container) return
      const result = await chrome.storage.sync.get(
        STORAGE_KEYS.THEME.PREFERENCE
      )
      const pref =
        (result[STORAGE_KEYS.THEME.PREFERENCE] as string | undefined) ??
        "system"
      const isDark =
        pref === "dark"
          ? true
          : pref === "light"
            ? false
            : window.matchMedia("(prefers-color-scheme: dark)").matches
      container.classList.toggle("dark", isDark)
    }

    const handleThemeChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: "sync" | "local" | "managed" | "session"
    ) => {
      if (area === "sync" && STORAGE_KEYS.THEME.PREFERENCE in changes) {
        void applyTheme()
      }
    }

    void applyTheme()
    chrome.storage.onChanged.addListener(handleThemeChange)

    document.addEventListener("selectionchange", queueSelectionCheck, true)
    document.addEventListener("pointerup", queueSelectionCheck, true)
    document.addEventListener("mouseup", queueSelectionCheck, true)
    document.addEventListener("keyup", queueSelectionCheck, true)
    document.addEventListener("keydown", handleKeyDown, true)

    plasmoGlobalStorage.watch({
      [STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG]: (change) => {
        config = {
          ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
          ...(change.newValue ?? {})
        }
        if (!config.showSelectionButton || !config.selectionActionsEnabled)
          hide()
      },
      [STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF]: () => {
        panelModel = ""
        void syncPanelModel()
      },
      [STORAGE_KEYS.PROVIDER.SELECTED_MODEL]: () => {
        panelModel = ""
        void syncPanelModel()
      }
    })

    ctx.onInvalidated(() => {
      document.removeEventListener("selectionchange", queueSelectionCheck, true)
      document.removeEventListener("pointerup", queueSelectionCheck, true)
      document.removeEventListener("mouseup", queueSelectionCheck, true)
      document.removeEventListener("keyup", queueSelectionCheck, true)
      document.removeEventListener("keydown", handleKeyDown, true)
      chrome.storage.onChanged.removeListener(handleThemeChange)
      stopStream()
      root?.unmount()
      ui.remove()
    })
  }
})

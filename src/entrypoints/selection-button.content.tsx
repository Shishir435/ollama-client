import type { PointerEvent as ReactPointerEvent } from "react"
import { flushSync } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { defineContentScript } from "wxt/utils/define-content-script"
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
import type { ChromeMessage, ContentExtractionConfig } from "@/types"
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
    let isMoreMenuOpen = false
    let isPinned = false
    let customInstruction = ""
    let overlayInteractingUntil = 0
    const appIconUrl = chrome.runtime.getURL("assets/icon-32.png")

    const markOverlayInteraction = () => {
      overlayInteractingUntil = Date.now() + 900
    }

    const ui = await createShadowRootUi(ctx, {
      name: "provider-selection-actions",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (uiContainer) => {
        tooltipContainer = uiContainer
        container = document.createElement("div")
        container.id = "selection-actions-root"
        container.style.display = "none"
        container.style.position = "fixed"
        container.style.zIndex = "2147483647"

        const style = document.createElement("style")
        style.textContent = `
          ${appStyles}

          :host {
            --background: oklch(1 0 0);
            --foreground: oklch(0.141 0.005 285.823);
            --color-background: var(--background);
            --color-foreground: var(--foreground);
            --sa-radius-lg: var(--radius-lg, var(--radius, 0.625rem));
            --sa-radius-md: var(--radius-md, calc(var(--radius, 0.625rem) - 2px));
            --sa-bg: #ffffff;
            --sa-fg: #18181b;
            --sa-muted: #71717a;
            --sa-border: #e4e4e7;
            --sa-hover: #f4f4f5;
            --sa-accent: #2563eb;
            --sa-danger: #dc2626;
            --sa-shadow: 0 16px 32px rgba(15, 23, 42, 0.18);
          }
          @media (prefers-color-scheme: dark) {
            :host {
              --background: oklch(0.141 0.005 285.823);
              --foreground: oklch(0.985 0 0);
              --color-background: var(--background);
              --color-foreground: var(--foreground);
              --sa-bg: #18181b;
              --sa-fg: #fafafa;
              --sa-muted: #a1a1aa;
              --sa-border: #3f3f46;
              --sa-hover: #27272a;
              --sa-accent: #60a5fa;
              --sa-danger: #f87171;
              --sa-shadow: 0 16px 32px rgba(0, 0, 0, 0.36);
            }
          }
          .sa-toolbar,
          .sa-panel {
            box-sizing: border-box;
            max-width: calc(100vw - 16px);
            background: var(--sa-bg);
            color: var(--sa-fg);
            border: 1px solid var(--sa-border);
            border-radius: var(--sa-radius-lg);
            box-shadow: var(--sa-shadow);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 12px;
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
            height: 36px;
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
            padding: 0 12px;
            cursor: pointer;
            white-space: nowrap;
            transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
          }
          .sa-button:hover:not(:disabled) {
            background: var(--sa-hover);
          }
          .sa-button.primary {
            color: var(--sa-accent);
            font-weight: 600;
            background: rgba(37, 99, 235, 0.1);
          }
          .sa-toolbar .sa-button {
            width: 38px;
            height: 38px;
            padding: 0;
          }
          .sa-toolbar .sa-button.primary {
            width: 38px;
            min-width: 38px;
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
            background: var(--sa-accent);
            color: #ffffff;
            border-color: var(--sa-accent);
          }
          .sa-button.danger {
            color: var(--sa-danger);
          }
          .sa-button:disabled {
            cursor: not-allowed;
            opacity: 0.45;
          }
          .sa-button svg,
          .sa-action-icon svg,
          .sa-drag-handle svg {
            width: 16px;
            height: 16px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          .sa-panel {
            width: min(470px, calc(100vw - 16px));
            padding: 18px;
          }
          .sa-panel-header,
          .sa-panel-actions,
          .sa-header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .sa-panel-header {
            justify-content: space-between;
            margin-bottom: 12px;
            align-items: flex-start;
          }
          .sa-title {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 16px;
            line-height: 1.25;
            font-weight: 700;
          }
          .sa-title-wrap {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
          }
          .sa-drag-handle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 36px;
            color: var(--sa-muted);
            cursor: grab;
            touch-action: none;
          }
          .sa-drag-handle:active {
            cursor: grabbing;
          }
          .sa-action-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 44px;
            flex: 0 0 auto;
            border-radius: var(--sa-radius-lg);
            color: var(--sa-accent);
            background: rgba(37, 99, 235, 0.1);
          }
          .sa-action-icon img {
            width: 32px;
            height: 32px;
            border-radius: var(--sa-radius-md);
          }
          .sa-title-meta {
            display: grid;
            min-width: 0;
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
            padding: 0 8px;
            height: 36px;
            border-color: var(--sa-border);
            background: var(--sa-bg);
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
            min-width: 42px;
            height: 34px;
            padding: 0 10px;
          }
          .sa-panel-actions .icon-only {
            width: 42px;
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
            height: 34px;
            padding: 0 10px !important;
            justify-content: flex-start;
            text-align: left;
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
      panelState = "streaming"
      overlayMode = "panel"
      renderOverlay()

      const request: SelectionActionRequest = {
        actionId: currentAction,
        selection: toSelectionPayload(currentCapture),
        customInstruction
      }

      streamPort = chrome.runtime.connect({
        name: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION
      })

      streamPort.onMessage.addListener((message: ChromeMessage) => {
        if (message.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK) {
          const payload = message.payload as { delta?: string } | undefined
          resultText += payload?.delta ?? ""
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
            message.error?.message || "Selection Action failed. Try again."
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

    await updateConfig()
    ui.mount()

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
      }
    })

    ctx.onInvalidated(() => {
      document.removeEventListener("selectionchange", queueSelectionCheck, true)
      document.removeEventListener("pointerup", queueSelectionCheck, true)
      document.removeEventListener("mouseup", queueSelectionCheck, true)
      document.removeEventListener("keyup", queueSelectionCheck, true)
      document.removeEventListener("keydown", handleKeyDown, true)
      stopStream()
      root?.unmount()
      ui.remove()
    })
  }
})

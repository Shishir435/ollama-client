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
import { buildShadowStyles } from "@/features/selection-actions/overlay-shadow-styles"
import { connectSelectionStream } from "@/features/selection-actions/overlay-stream"
import type {
  SelectionActionId,
  SelectionActionRequest
} from "@/features/selection-actions/types"
import i18n from "@/i18n/config"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { isSelectedModelRef } from "@/lib/providers/selected-model"
import type {
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
    // ── DOM refs ──────────────────────────────────────────────────────────
    let container: HTMLDivElement | null = null
    let tooltipContainer: HTMLElement | ShadowRoot | null = null
    let root: Root | null = null

    // ── Overlay state ─────────────────────────────────────────────────────
    let config: ContentExtractionConfig = DEFAULT_CONTENT_EXTRACTION_CONFIG
    let currentCapture: SelectionCapture | null = null
    let currentAction: SelectionActionId = "summarize"
    let overlayMode: OverlayMode = "toolbar"
    let panelState: PanelState = "idle"
    let resultText = ""
    let errorText = ""
    let isThinking = false
    let thinkingText = ""
    let isMoreMenuOpen = false
    let isPinned = false
    let customInstruction = ""
    let overlayInteractingUntil = 0

    // ── Model state ───────────────────────────────────────────────────────
    let availableModels: ProviderModel[] = []
    let panelModel = ""
    let panelProviderId: string | undefined
    let modelsLoadedOnce = false

    // ── Stream ────────────────────────────────────────────────────────────
    let streamPort: chrome.runtime.Port | null = null

    const appIconUrl = chrome.runtime.getURL("assets/icon-32.png")

    // ── Shadow DOM setup ──────────────────────────────────────────────────
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
        style.textContent = buildShadowStyles(appStyles)

        uiContainer.append(style)
        uiContainer.append(container)
        root = createRoot(container)

        const mark = markOverlayInteraction
        container.addEventListener("pointerdown", mark, true)
        container.addEventListener("mousedown", mark, true)
        container.addEventListener("click", mark, true)
        container.addEventListener("keydown", mark, true)
        container.addEventListener("input", mark, true)
        container.addEventListener("focusin", mark, true)

        // Stop keyboard events from bubbling out of the shadow DOM into the
        // host page. Without this, sites like GitHub intercept keypresses
        // (e.g. "t" opens file finder, "/" focuses search) while the user is
        // typing in our Input. Capture-phase listeners on document (Escape,
        // selectionchange) still fire because capture runs before bubble.
        const stopKey = (e: Event) => e.stopPropagation()
        container.addEventListener("keydown", stopKey)
        container.addEventListener("keyup", stopKey)
        container.addEventListener("keypress", stopKey)

        return container
      }
    })

    // ── Config + model sync ───────────────────────────────────────────────
    const syncLanguage = async () => {
      const stored = await plasmoGlobalStorage.get<string>(
        STORAGE_KEYS.LANGUAGE
      )
      if (stored && i18n.language !== stored) {
        await i18n.changeLanguage(stored)
      }
    }

    const updateConfig = async () => {
      const stored = await plasmoGlobalStorage.get<ContentExtractionConfig>(
        STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG
      )
      config = { ...DEFAULT_CONTENT_EXTRACTION_CONFIG, ...(stored ?? {}) }
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
        if (resp?.success && resp.data && "models" in (resp.data as object)) {
          const all = (resp.data as { models: ProviderModel[] }).models
          availableModels = all.filter(
            (m) => !isEmbeddingModel(m.model, m.details?.families ?? [])
          )
          modelsLoadedOnce = true
          renderOverlay(false)
        }
      } catch {
        // background not ready yet
      }
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    const enabledActionIds = () =>
      (config.selectionActionsEnabledIds?.length
        ? config.selectionActionsEnabledIds
        : DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsEnabledIds) as SelectionActionId[]

    const markOverlayInteraction = () => {
      overlayInteractingUntil = Date.now() + 900
    }

    // ── Placement ─────────────────────────────────────────────────────────
    const place = (top: number, anchorLeft: number) => {
      if (!container) return
      container.style.display = "block"
      container.style.visibility = "hidden"

      const viewportMargin = 8
      const width = container.offsetWidth
      const height = container.offsetHeight
      const maxLeft = window.innerWidth - width - viewportMargin
      const maxTop = window.innerHeight - height - viewportMargin
      const targetLeft = clamp(anchorLeft - width / 2, viewportMargin, maxLeft)
      const targetTop = clamp(top, viewportMargin, maxTop)

      container.style.left = `${targetLeft}px`
      container.style.top = `${targetTop}px`

      // Some pages (e.g. YouTube) apply CSS transforms to ancestor elements
      // which shift the fixed-positioning context. Measure actual viewport
      // position and correct for any drift.
      const actual = container.getBoundingClientRect()
      const driftX = actual.left - targetLeft
      const driftY = actual.top - targetTop
      if (Math.abs(driftX) > 0.5 || Math.abs(driftY) > 0.5) {
        container.style.left = `${targetLeft - driftX}px`
        container.style.top = `${targetTop - driftY}px`
      }

      container.style.visibility = "visible"
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

      const handleMove = (e: PointerEvent) => {
        if (!container) return
        const margin = 8
        const w = container.offsetWidth
        const h = container.offsetHeight
        container.style.left = `${clamp(e.clientX - offsetX, margin, window.innerWidth - w - margin)}px`
        container.style.top = `${clamp(e.clientY - offsetY, margin, window.innerHeight - h - margin)}px`
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

    // ── Render ────────────────────────────────────────────────────────────
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
            onActionChange={runAction}
            onBack={goBackToToolbar}
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
          currentCapture.rect.left + currentCapture.rect.width / 2
        )
      }
    }

    // ── Stream ────────────────────────────────────────────────────────────
    const stopStream = () => {
      if (!streamPort) return
      streamPort.postMessage({
        type: MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION
      })
      streamPort.disconnect()
      streamPort = null
    }

    const startAction = async () => {
      if (!currentCapture) return
      stopStream()
      resultText = ""
      errorText = ""
      isThinking = false
      thinkingText = ""
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

      streamPort = connectSelectionStream(request, {
        onChunk: ({ visibleDelta, thinkingDelta, isThinking: thinking }) => {
          resultText += visibleDelta
          thinkingText += thinkingDelta
          isThinking = thinking
          renderOverlay(false)
        },
        onDone: () => {
          panelState = "done"
          isThinking = false
          streamPort?.disconnect()
          streamPort = null
          renderOverlay(false)
        },
        onError: (message) => {
          panelState = "error"
          errorText = message
          isThinking = false
          streamPort?.disconnect()
          streamPort = null
          renderOverlay(false)
        }
      })
    }

    // ── Actions ───────────────────────────────────────────────────────────
    const runAction = (actionId: SelectionActionId) => {
      markOverlayInteraction()
      stopStream()
      currentAction = actionId
      isMoreMenuOpen = false
      overlayMode = "panel"
      resultText = ""
      errorText = ""
      isThinking = false
      thinkingText = ""
      void fetchModels()

      if (actionId === "custom") {
        panelState = "idle"
        renderOverlay()
        return
      }

      void startAction()
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
      customInstruction = ""
      isMoreMenuOpen = false
      isPinned = false
    }

    const goBackToToolbar = () => {
      stopStream()
      overlayMode = "toolbar"
      panelState = "idle"
      resultText = ""
      errorText = ""
      isThinking = false
      thinkingText = ""
      isMoreMenuOpen = false
      renderOverlay()
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

    // ── Selection detection ───────────────────────────────────────────────
    const showForSelection = (capture: SelectionCapture) => {
      currentCapture = { ...capture, range: capture.range?.cloneRange() }
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

    const queueSelectionCheck = () =>
      window.setTimeout(handleSelectionChange, 80)

    // ── Theme sync ────────────────────────────────────────────────────────
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

    // ── Bootstrap ─────────────────────────────────────────────────────────
    await Promise.all([updateConfig(), syncPanelModel(), syncLanguage()])
    ui.mount()
    void applyTheme()

    // ── Storage watchers ──────────────────────────────────────────────────
    chrome.storage.onChanged.addListener(handleThemeChange)
    plasmoGlobalStorage.watch({
      [STORAGE_KEYS.LANGUAGE]: (change) => {
        const lng = change.newValue as string | undefined
        if (lng) void i18n.changeLanguage(lng)
      },
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

    // ── DOM event listeners ───────────────────────────────────────────────
    document.addEventListener("selectionchange", queueSelectionCheck, true)
    document.addEventListener("pointerup", queueSelectionCheck, true)
    document.addEventListener("mouseup", queueSelectionCheck, true)
    document.addEventListener("keyup", queueSelectionCheck, true)
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") hide()
      },
      true
    )

    ctx.onInvalidated(() => {
      document.removeEventListener("selectionchange", queueSelectionCheck, true)
      document.removeEventListener("pointerup", queueSelectionCheck, true)
      document.removeEventListener("mouseup", queueSelectionCheck, true)
      document.removeEventListener("keyup", queueSelectionCheck, true)
      chrome.storage.onChanged.removeListener(handleThemeChange)
      stopStream()
      root?.unmount()
      ui.remove()
    })
  }
})

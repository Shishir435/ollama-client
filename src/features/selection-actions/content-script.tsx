import type { PointerEvent as ReactPointerEvent } from "react"
import { flushSync } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { defineContentScript } from "wxt/utils/define-content-script"
import { SelectionActionsOverlay } from "@/features/selection-actions/components/selection-actions-overlay"
import {
  copySelectionResult,
  insertBelowCapturedSelection,
  openSelectionResultInChat,
  replaceCapturedSelection
} from "@/features/selection-actions/content-result-actions"
import {
  applyStoredTheme,
  loadAvailablePanelModels,
  loadSelectedPanelModel,
  loadSelectionConfig,
  syncSelectionLanguage
} from "@/features/selection-actions/content-settings"
import {
  startSelectionActionStream,
  stopSelectionStream
} from "@/features/selection-actions/content-stream"
import {
  getSelectionCapture,
  type SelectionCapture
} from "@/features/selection-actions/dom"
import {
  placeSelectionOverlay,
  startOverlayDrag
} from "@/features/selection-actions/overlay-position"
import { buildShadowStyles } from "@/features/selection-actions/overlay-shadow-styles"
import {
  createSelectionOverlayState,
  reduceSelectionOverlayState
} from "@/features/selection-actions/overlay-state"
import type { SelectionActionId } from "@/features/selection-actions/types"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ContentExtractionConfig, ProviderModel } from "@/types"

export const createSelectionActionsContentScript = (appStyles: string) =>
  defineContentScript({
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
      let overlayState = createSelectionOverlayState()
      let overlayInteractingUntil = 0

      // ── Model state ───────────────────────────────────────────────────────
      let availableModels: ProviderModel[] = []
      let panelModel = ""
      let panelProviderId: string | undefined
      let modelsLoadedOnce = false

      // ── Stream ────────────────────────────────────────────────────────────
      let streamPort: chrome.runtime.Port | null = null

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

      const updateConfig = async () => {
        config = await loadSelectionConfig()
      }

      const syncPanelModel = async () => {
        const selected = await loadSelectedPanelModel(panelModel)
        panelModel = selected.model
        panelProviderId = selected.providerId
      }

      const fetchModels = async () => {
        if (modelsLoadedOnce) return
        try {
          availableModels = await loadAvailablePanelModels()
          modelsLoadedOnce = true
          renderOverlay(false)
        } catch {
          // background not ready yet
        }
      }

      // ── Helpers ───────────────────────────────────────────────────────────
      const enabledActionIds = () =>
        (config.selectionActionsEnabledIds?.length
          ? config.selectionActionsEnabledIds
          : DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsEnabledIds) as SelectionActionId[]

      const selectionActionsVisible = () => config.selectionActionsEnabled

      const markOverlayInteraction = () => {
        overlayInteractingUntil = Date.now() + 900
      }

      const dispatchOverlay = (
        event: Parameters<typeof reduceSelectionOverlayState>[1]
      ) => {
        overlayState = reduceSelectionOverlayState(overlayState, event)
      }

      const handleDragStart = (event: ReactPointerEvent<HTMLElement>) => {
        if (!container) return
        startOverlayDrag(event, {
          container,
          markInteraction: markOverlayInteraction,
          onDragStart: () => dispatchOverlay({ type: "pin.enable" }),
          onDragEnd: () => renderOverlay(false)
        })
      }

      // ── Render ────────────────────────────────────────────────────────────
      const renderOverlay = (shouldPlace = true) => {
        if (!root || !container || !currentCapture) return
        const hasResult =
          overlayState.panelState === "done" && !!overlayState.resultText.trim()
        const canReplace = hasResult && currentCapture.canReplace
        const canInsert = hasResult && currentCapture.canInsert

        const jsx = (
          <SelectionActionsOverlay
            mode={overlayState.mode}
            panelState={overlayState.panelState}
            currentAction={overlayState.currentAction}
            enabledActionIds={enabledActionIds()}
            isMoreMenuOpen={overlayState.isMoreMenuOpen}
            resultText={overlayState.resultText}
            errorText={overlayState.errorText}
            isThinking={overlayState.isThinking}
            thinkingText={overlayState.thinkingText}
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
            isPinned={overlayState.isPinned}
            customInstruction={overlayState.customInstruction}
            onRunAction={runAction}
            onActionChange={runAction}
            onBack={goBackToToolbar}
            onToggleMore={() => {
              markOverlayInteraction()
              dispatchOverlay({ type: "menu.toggle" })
              renderOverlay()
            }}
            onCopy={() => void copyResult()}
            onReplace={replaceSelection}
            onInsertBelow={insertBelow}
            onOpenChat={() => void openInChat()}
            onRetry={() => void startAction()}
            onCancel={() => {
              stopStream()
              dispatchOverlay({ type: "panel.cancel" })
              renderOverlay(false)
            }}
            onClose={hide}
            onTogglePin={() => {
              markOverlayInteraction()
              dispatchOverlay({ type: "pin.toggle" })
              renderOverlay(false)
            }}
            onCustomInstructionChange={(value) => {
              markOverlayInteraction()
              dispatchOverlay({ type: "custom.set", value })
              renderOverlay(false)
            }}
            onRunCustom={() => void startAction()}
            onDragStart={handleDragStart}
          />
        )

        // flushSync only when we need to read rendered dimensions for placement.
        // Non-placement renders (streaming chunks, typing) go through React's
        // normal scheduler — no paint-blocking.
        if (shouldPlace && !overlayState.isPinned) {
          flushSync(() => root?.render(jsx))
          placeSelectionOverlay(
            container,
            currentCapture.rect.bottom + 10,
            currentCapture.rect.left + currentCapture.rect.width / 2
          )
        } else {
          root.render(jsx)
        }
      }

      // ── Stream ────────────────────────────────────────────────────────────
      const stopStream = () => {
        streamPort = stopSelectionStream(streamPort)
      }

      const startAction = async () => {
        if (!currentCapture) return
        stopStream()
        streamPort = startSelectionActionStream({
          capture: currentCapture,
          state: overlayState,
          panelModel,
          panelProviderId,
          dispatch: dispatchOverlay,
          render: renderOverlay,
          onFinish: () => {
            streamPort = null
          }
        })
      }

      // ── Actions ───────────────────────────────────────────────────────────
      const runAction = (actionId: SelectionActionId) => {
        markOverlayInteraction()
        stopStream()
        dispatchOverlay({ type: "action.open", actionId })
        void fetchModels()

        if (actionId === "custom") {
          renderOverlay()
          return
        }

        void startAction()
      }

      const hide = () => {
        stopStream()
        root?.render(null)
        if (container) container.style.display = "none"
        dispatchOverlay({ type: "overlay.hide" })
      }

      const goBackToToolbar = () => {
        stopStream()
        dispatchOverlay({ type: "toolbar.back" })
        renderOverlay()
      }

      const openInChat = async () => {
        const didOpen = await openSelectionResultInChat(
          overlayState.resultText,
          currentCapture
        )
        if (didOpen) hide()
      }

      const copyResult = async () => {
        await copySelectionResult(overlayState.resultText)
      }

      const replaceSelection = () => {
        if (replaceCapturedSelection(currentCapture, overlayState.resultText)) {
          hide()
        }
      }

      const insertBelow = () => {
        if (
          insertBelowCapturedSelection(currentCapture, overlayState.resultText)
        ) {
          hide()
        }
      }

      // ── Selection detection ───────────────────────────────────────────────
      const showForSelection = (capture: SelectionCapture) => {
        currentCapture = { ...capture, range: capture.range?.cloneRange() }
        dispatchOverlay({
          type: "selection.show",
          enabledActionIds: enabledActionIds()
        })
        renderOverlay()
      }

      const handleSelectionChange = () => {
        if (Date.now() < overlayInteractingUntil) return
        if (overlayState.isPinned || overlayState.mode === "panel") return
        if (!selectionActionsVisible()) {
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
        await applyStoredTheme(container)
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
      await Promise.all([
        updateConfig(),
        syncPanelModel(),
        syncSelectionLanguage()
      ])
      ui.mount()
      void applyTheme()

      // ── Storage watchers ──────────────────────────────────────────────────
      chrome.storage.onChanged.addListener(handleThemeChange)
      const storageWatchCallbacks = {
        [STORAGE_KEYS.LANGUAGE]: (change: { newValue?: unknown }) => {
          const lng = change.newValue as string | undefined
          if (lng) {
            void import("@/i18n/config").then(({ default: i18n }) =>
              i18n.changeLanguage(lng)
            )
          }
        },
        [STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG]: (change: {
          newValue?: unknown
        }) => {
          config = {
            ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
            ...((change.newValue as Partial<ContentExtractionConfig>) ?? {})
          }
          if (!selectionActionsVisible()) hide()
        },
        [STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF]: () => {
          panelModel = ""
          modelsLoadedOnce = false
          void syncPanelModel()
        },
        [STORAGE_KEYS.PROVIDER.SELECTED_MODEL]: () => {
          panelModel = ""
          modelsLoadedOnce = false
          void syncPanelModel()
        }
      }
      plasmoGlobalStorage.watch(storageWatchCallbacks)

      // ── DOM event listeners ───────────────────────────────────────────────
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") hide()
      }
      document.addEventListener("selectionchange", queueSelectionCheck, true)
      document.addEventListener("pointerup", queueSelectionCheck, true)
      document.addEventListener("mouseup", queueSelectionCheck, true)
      document.addEventListener("keyup", queueSelectionCheck, true)
      document.addEventListener("keydown", handleEscape, true)

      ctx.onInvalidated(() => {
        document.removeEventListener(
          "selectionchange",
          queueSelectionCheck,
          true
        )
        document.removeEventListener("pointerup", queueSelectionCheck, true)
        document.removeEventListener("mouseup", queueSelectionCheck, true)
        document.removeEventListener("keyup", queueSelectionCheck, true)
        document.removeEventListener("keydown", handleEscape, true)
        chrome.storage.onChanged.removeListener(handleThemeChange)
        plasmoGlobalStorage.unwatch(storageWatchCallbacks)
        stopStream()
        root?.unmount()
        ui.remove()
      })
    }
  })

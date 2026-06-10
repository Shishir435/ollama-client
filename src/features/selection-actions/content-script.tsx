import { createRoot, type Root } from "react-dom/client"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { defineContentScript } from "wxt/utils/define-content-script"
import {
  applyStoredTheme,
  loadSelectedPanelModel,
  loadSelectionConfig,
  syncSelectionLanguage
} from "@/features/selection-actions/content-settings"
import {
  getSelectionCapture,
  type SelectionCapture
} from "@/features/selection-actions/dom"
import { buildShadowStyles } from "@/features/selection-actions/overlay-shadow-styles"
import { SelectionOverlayApp } from "@/features/selection-actions/selection-overlay-app"
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
    cssInjectionMode: "manual",
    async main(ctx) {
      let container: HTMLDivElement | null = null
      let tooltipContainer: HTMLElement | ShadowRoot | null = null
      let root: Root | null = null

      // ── Shared mutable refs (read from React component) ──────────────
      const configRef = { current: DEFAULT_CONTENT_EXTRACTION_CONFIG }
      const captureRef = { current: null as SelectionCapture | null }
      const modelsRef = { current: [] as ProviderModel[] }
      const panelModelRef = { current: "" }
      const panelProviderIdRef = { current: undefined as string | undefined }

      let overlayInteractingUntil = 0
      let selectionKey = 0
      const panelActiveRef = { current: false }

      // ── Shadow DOM setup ─────────────────────────────────────────────
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

          const mark = () => {
            overlayInteractingUntil = Date.now() + 900
          }
          container.addEventListener("pointerdown", mark, true)
          container.addEventListener("mousedown", mark, true)
          container.addEventListener("click", mark, true)
          container.addEventListener("keydown", mark, true)
          container.addEventListener("input", mark, true)
          container.addEventListener("focusin", mark, true)

          const stopKey = (e: Event) => e.stopPropagation()
          container.addEventListener("keydown", stopKey)
          container.addEventListener("keyup", stopKey)
          container.addEventListener("keypress", stopKey)

          return container
        }
      })

      // ── Config / model helpers ───────────────────────────────────────
      const updateConfig = async () => {
        configRef.current = await loadSelectionConfig()
      }
      const syncPanelModel = async () => {
        const selected = await loadSelectedPanelModel(panelModelRef.current)
        panelModelRef.current = selected.model
        panelProviderIdRef.current = selected.providerId
      }

      // ── Render app (called once, then reacts to dispatch) ────────────
      const renderApp = () => {
        if (!root || !container) return
        root.render(
          <SelectionOverlayApp
            key={selectionKey}
            container={container}
            tooltipContainer={tooltipContainer}
            configRef={configRef}
            captureRef={captureRef}
            modelsRef={modelsRef}
            panelActiveRef={panelActiveRef}
            panelModelRef={panelModelRef}
            panelProviderIdRef={panelProviderIdRef}
            onModelChange={(model, providerId) => {
              panelModelRef.current = model
              panelProviderIdRef.current = providerId
            }}
            onClose={hide}
          />
        )
      }

      // ── Show / hide ──────────────────────────────────────────────────
      const hide = () => {
        if (!container) return
        container.style.display = "none"
        panelActiveRef.current = false
      }

      // ── Stream (imported lazily to avoid init-order issues) ──────────
      // Stream lifecycle is handled inside SelectionOverlayApp

      // ── Selection detection ──────────────────────────────────────────
      const handleSelectionChange = () => {
        if (Date.now() < overlayInteractingUntil) return
        if (panelActiveRef.current) return
        if (!configRef.current.selectionActionsEnabled) {
          hide()
          return
        }
        const capture = getSelectionCapture()
        const minChars =
          configRef.current.selectionActionsMinChars ??
          DEFAULT_CONTENT_EXTRACTION_CONFIG.selectionActionsMinChars
        if (!capture || capture.text.length < minChars) {
          hide()
          return
        }
        captureRef.current = {
          ...capture,
          range: capture.range?.cloneRange()
        }
        selectionKey++
        renderApp()
      }

      const queueSelectionCheck = () =>
        window.setTimeout(handleSelectionChange, 80)

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") hide()
      }

      // ── Theme sync ───────────────────────────────────────────────────
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

      // ── Bootstrap ────────────────────────────────────────────────────
      await Promise.all([
        updateConfig(),
        syncPanelModel(),
        syncSelectionLanguage()
      ])
      ui.mount()
      void applyTheme()
      renderApp()

      // ── Storage watchers ─────────────────────────────────────────────
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
          configRef.current = {
            ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
            ...((change.newValue as Partial<ContentExtractionConfig>) ?? {})
          }
          if (!configRef.current.selectionActionsEnabled) hide()
        },
        [STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF]: () => {
          panelModelRef.current = ""
          void syncPanelModel()
        },
        [STORAGE_KEYS.PROVIDER.SELECTED_MODEL]: () => {
          panelModelRef.current = ""
          void syncPanelModel()
        }
      }
      plasmoGlobalStorage.watch(storageWatchCallbacks)

      // ── DOM event listeners ──────────────────────────────────────────
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
        root?.unmount()
        ui.remove()
      })
    }
  })

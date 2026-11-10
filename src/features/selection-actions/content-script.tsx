import { createRoot, type Root } from "react-dom/client"
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { defineContentScript } from "wxt/utils/define-content-script"
import {
  applyStoredTheme,
  createLatestSelectionConfigRefresh,
  loadSelectedPanelModel,
  loadSelectionConfig,
  syncSelectionLanguage,
  watchSystemTheme
} from "@/features/selection-actions/content-settings"
import {
  focusSelectionAnchor,
  getSelectionCapture,
  pickReturnFocusTarget,
  type SelectionCapture
} from "@/features/selection-actions/dom"
import { buildShadowStyles } from "@/features/selection-actions/overlay-shadow-styles"
import { SelectionOverlayApp } from "@/features/selection-actions/selection-overlay-app"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoSyncStorage } from "@/lib/plasmo-global-storage"
import {
  SELECTION_OVERLAY_READY_EVENT,
  SELECTION_OVERLAY_REQUEST_ID_GLOBAL,
  type SelectionOverlayReadyDetail
} from "@/protocol/content-messages"
import type { ProviderModel } from "@/types"

/** Frames narrower than this are ads or widgets, never somewhere to read. */
const MIN_FRAME_WIDTH = 200

export const createSelectionActionsContentScript = (appStyles: string) =>
  defineContentScript({
    matches: ["<all_urls>"],
    allFrames: true,
    registration: "runtime",
    cssInjectionMode: "manual",
    async main(ctx) {
      const requestId = Reflect.get(
        globalThis,
        SELECTION_OVERLAY_REQUEST_ID_GLOBAL
      )
      Reflect.deleteProperty(globalThis, SELECTION_OVERLAY_REQUEST_ID_GLOBAL)
      if (typeof requestId !== "string" || requestId.length === 0) return

      let container: HTMLDivElement | null = null
      let tooltipContainer: HTMLElement | ShadowRoot | null = null
      let root: Root | null = null

      // ── Shared mutable refs (read from React component) ──────────────
      const configRef = { current: DEFAULT_CONTENT_EXTRACTION_CONFIG }
      const captureRef = { current: null as SelectionCapture | null }
      const modelsRef = { current: [] as ProviderModel[] }
      const panelModelRef = { current: "" }
      const panelProviderIdRef = { current: undefined as string | undefined }

      /** Where focus goes back to when the overlay closes with focus inside it. */
      let returnFocusTarget: HTMLElement | null = null

      let overlayInteractingUntil = 0
      let selectionKey = 0
      let overlayOpen = false
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

          /**
           * Keys typed in the panel must not reach page hotkeys. The stop sits
           * in the bubble phase on the container: a capture-phase stop on the
           * host would also keep the event from React's own listeners, which
           * live on this same container.
           */
          const stopKey = (e: Event) => e.stopPropagation()
          container.addEventListener("keydown", stopKey)
          container.addEventListener("keyup", stopKey)
          container.addEventListener("keypress", stopKey)
          uiContainer.addEventListener("keydown", stopKey)
          uiContainer.addEventListener("keyup", stopKey)
          uiContainer.addEventListener("keypress", stopKey)

          return container
        }
      })

      // ── Config / model helpers ───────────────────────────────────────
      const configRefresh = createLatestSelectionConfigRefresh(
        loadSelectionConfig,
        (config) => {
          configRef.current = config
          renderApp()
          if (!config.selectionActionsEnabled) hide()
        }
      )
      const syncPanelModel = async () => {
        const selected = await loadSelectedPanelModel(panelModelRef.current)
        panelModelRef.current = selected.model
        panelProviderIdRef.current = selected.providerId
        renderApp()
      }

      const onPanelActiveChange = (active: boolean) => {
        panelActiveRef.current = active
      }
      const onModelsLoaded = (models: ProviderModel[]) => {
        modelsRef.current = models
        renderApp()
      }
      // ── Render app (called once, then reacts to dispatch) ────────────
      const renderApp = () => {
        if (!overlayOpen || !root || !container) return
        root.render(
          <SelectionOverlayApp
            key={selectionKey}
            container={container}
            tooltipContainer={tooltipContainer}
            config={configRef.current}
            capture={captureRef.current}
            models={modelsRef.current}
            panelModel={panelModelRef.current}
            panelProviderId={panelProviderIdRef.current}
            onPanelActiveChange={onPanelActiveChange}
            onModelsLoaded={onModelsLoaded}
            onModelChange={(model, providerId) => {
              panelModelRef.current = model
              panelProviderIdRef.current = providerId
              renderApp()
            }}
            onClose={hide}
          />
        )
      }

      // ── Show / hide ──────────────────────────────────────────────────
      /**
       * Close the overlay. Unmounting the app, not just hiding it, is what
       * stops an in-flight selection stream (its unmount cleanup cancels the
       * port); a hidden panel kept spending the model's tokens otherwise.
       */
      const hide = () => {
        if (!container) return
        const wasOpen = overlayOpen
        overlayOpen = false
        const shadow = container.getRootNode()
        const focusWasInside =
          shadow instanceof ShadowRoot &&
          !!shadow.activeElement &&
          container.contains(shadow.activeElement)
        container.style.display = "none"
        panelActiveRef.current = false
        if (wasOpen) root?.render(null)
        if (focusWasInside) {
          if (returnFocusTarget?.isConnected) {
            returnFocusTarget.focus({ preventScroll: true })
          } else {
            focusSelectionAnchor(captureRef.current?.range)
          }
        }
      }

      /**
       * Whether a scroll moved the selection. The window scrolling always does;
       * another element only when it holds the selection, so an unrelated
       * carousel or chat feed scrolling on its own no longer closes the toolbar.
       */
      const scrollMovedSelection = (target: EventTarget | null) => {
        if (!(target instanceof Node)) return true
        if (target === document || target === document.documentElement) {
          return true
        }
        const current = captureRef.current
        const anchor =
          current?.editableTarget ?? current?.range?.commonAncestorContainer
        return !anchor || target.contains(anchor)
      }

      /** The toolbar is anchored to where the selection was; scrolling it leaves it stranded. */
      const handleScroll = (event: Event) => {
        if (panelActiveRef.current) return
        if (!scrollMovedSelection(event.target)) return
        if (container && container.style.display !== "none") hide()
      }

      /**
       * Every frame runs this script. Only the top frame, or a frame big
       * enough to hold real content and focused by the user, may show the
       * toolbar; ad and tracking frames never do.
       */
      const frameMayShowToolbar = () => {
        if (window === window.top) return true
        if (window.innerWidth < MIN_FRAME_WIDTH) return false
        return document.hasFocus()
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
        if (!frameMayShowToolbar()) {
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
        returnFocusTarget = pickReturnFocusTarget(
          capture,
          document.activeElement,
          ui.shadowHost
        )
        selectionKey++
        overlayOpen = true
        renderApp()
      }

      const queueSelectionCheck = () =>
        window.setTimeout(handleSelectionChange, 80)

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          hide()
          return
        }
        // Alt+Shift+Period moves keyboard focus into a visible toolbar.
        if (
          e.altKey &&
          e.shiftKey &&
          e.code === "Period" &&
          overlayOpen &&
          container &&
          container.style.display !== "none"
        ) {
          const first = container.querySelector<HTMLElement>(
            "[role='toolbar'] button:not([disabled])"
          )
          if (first) {
            e.preventDefault()
            first.focus({ preventScroll: true })
          }
        }
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
        configRefresh.run(),
        syncPanelModel(),
        syncSelectionLanguage()
      ])
      ui.mount()
      void applyTheme()
      renderApp()
      document.dispatchEvent(
        new CustomEvent<SelectionOverlayReadyDetail>(
          SELECTION_OVERLAY_READY_EVENT,
          { detail: { requestId } }
        )
      )

      // ── Storage watchers ─────────────────────────────────────────────
      chrome.storage.onChanged.addListener(handleThemeChange)
      const unwatchSystemTheme = watchSystemTheme(() => void applyTheme())
      const storageWatchCallbacks = {
        [STORAGE_KEYS.LANGUAGE]: (change: { newValue?: unknown }) => {
          const lng = change.newValue as string | undefined
          if (lng) {
            void import("@/i18n/selection-config").then(
              ({ setSelectionLanguage }) => setSelectionLanguage(lng)
            )
          }
        },
        [STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG]: () => {
          void configRefresh.run()
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
      plasmoSyncStorage.watch(storageWatchCallbacks)

      // ── DOM event listeners ──────────────────────────────────────────
      document.addEventListener("selectionchange", queueSelectionCheck, true)
      document.addEventListener("pointerup", queueSelectionCheck, true)
      document.addEventListener("mouseup", queueSelectionCheck, true)
      document.addEventListener("keyup", queueSelectionCheck, true)
      document.addEventListener("keydown", handleEscape, true)
      window.addEventListener("scroll", handleScroll, {
        capture: true,
        passive: true
      })
      queueSelectionCheck()

      ctx.onInvalidated(() => {
        configRefresh.invalidate()
        document.removeEventListener(
          "selectionchange",
          queueSelectionCheck,
          true
        )
        document.removeEventListener("pointerup", queueSelectionCheck, true)
        document.removeEventListener("mouseup", queueSelectionCheck, true)
        document.removeEventListener("keyup", queueSelectionCheck, true)
        document.removeEventListener("keydown", handleEscape, true)
        window.removeEventListener("scroll", handleScroll, true)
        chrome.storage.onChanged.removeListener(handleThemeChange)
        unwatchSystemTheme()
        plasmoSyncStorage.unwatch(storageWatchCallbacks)
        root?.unmount()
        ui.remove()
      })
    }
  })

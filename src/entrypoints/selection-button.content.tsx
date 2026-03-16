import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root"
import { defineContentScript } from "wxt/utils/define-content-script"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ContentExtractionConfig } from "@/types"

// Lite translations embedded directly to avoid imports
const translations: Record<string, Record<string, string>> = {
  de: {
    "selection_button.label": "Lokalen LLM fragen",
    "selection_button.tooltip": "Zum Local LLM Client hinzufügen"
  },
  en: {
    "selection_button.label": "Ask Local LLM",
    "selection_button.tooltip": "Add to Local LLM Client"
  },
  es: {
    "selection_button.label": "Preguntar al LLM local",
    "selection_button.tooltip": "Añadir al cliente LLM local"
  },
  fr: {
    "selection_button.label": "Demander au LLM local",
    "selection_button.tooltip": "Ajouter au client LLM local"
  },
  hi: {
    "selection_button.label": "स्थानीय LLM से पूछें",
    "selection_button.tooltip": "स्थानीय LLM क्लाइंट में जोड़ें"
  },
  it: {
    "selection_button.label": "Chiedi al LLM locale",
    "selection_button.tooltip": "Aggiungi al client LLM locale"
  },
  ja: {
    "selection_button.label": "ローカルLLMに聞く",
    "selection_button.tooltip": "ローカルLLMクライアントに追加"
  },
  ru: {
    "selection_button.label": "Спросить локальный LLM",
    "selection_button.tooltip": "Добавить в локальный LLM клиент"
  },
  zh: {
    "selection_button.label": "询问本地 LLM",
    "selection_button.tooltip": "添加到本地 LLM 客户端"
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  cssInjectionMode: "ui",
  async main(ctx) {
    let container: HTMLDivElement | null = null
    let shadowRoot: ShadowRoot | null = null
    let isEnabled = true
    let currentLanguage = "en"
    let selectionText = ""

    // Create the UI using WXT shadow root helper
    const ui = await createShadowRootUi(ctx, {
      name: "provider-selection-button",
      position: "inline",
      anchor: "body",
      append: "last",
      onMount: (uiContainer) => {
        container = document.createElement("div")
        container.id = "selection-button-root"
        container.style.display = "none"
        container.style.position = "absolute"
        container.style.zIndex = "2147483647"

        // Inline styles to match the previous look without tailwind
        const style = document.createElement("style")
        style.textContent = `
          .selection-button {
            display: flex;
            align-items: center;
            gap: 8px;
            height: 32px;
            padding: 0 12px;
            background: #f4f4f5;
            color: #18181b;
            border: 1px solid #e4e4e7;
            border-radius: 8px;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            transition: all 0.2s;
            user-select: none;
            white-space: nowrap;
          }
          .selection-button:hover {
            background: #e4e4e7;
            transform: translateY(-2px);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
          }
          .selection-button svg {
            width: 14px;
            height: 14px;
          }
          .dark .selection-button {
            background: #27272a;
            color: #fafafa;
            border-color: #3f3f46;
          }
          .dark .selection-button:hover {
            background: #3f3f46;
          }
        `
        uiContainer.append(style)
        uiContainer.append(container)
        shadowRoot = uiContainer.getRootNode() as ShadowRoot
        return container
      }
    })

    const updateConfig = async () => {
      const config = await plasmoGlobalStorage.get<ContentExtractionConfig>(
        STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG
      )
      isEnabled =
        config?.showSelectionButton ??
        DEFAULT_CONTENT_EXTRACTION_CONFIG.showSelectionButton
      currentLanguage =
        (await plasmoGlobalStorage.get<string>(STORAGE_KEYS.LANGUAGE)) || "en"
    }

    const t = (key: "label" | "tooltip") => {
      const lang = currentLanguage.split("-")[0]
      const pack = translations[lang] || translations.en
      return (
        pack[`selection_button.${key}`] ||
        translations.en[`selection_button.${key}`]
      )
    }

    const renderButton = () => {
      if (!container) return
      container.innerHTML = `
        <button class="selection-button" title="${t("tooltip")}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"></path></svg>
          <span>${t("label")}</span>
        </button>
      `
      container.querySelector("button")?.addEventListener("click", async () => {
        try {
          await chrome.runtime.sendMessage({
            type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
            payload: selectionText
          })
          hideButton()
          window.getSelection()?.removeAllRanges()
        } catch (error) {
          console.error("Failed to send selection:", error)
        }
      })
    }

    const showButton = (top: number, left: number) => {
      if (!container || !isEnabled) return
      renderButton()
      container.style.top = `${top}px`
      container.style.left = `${left}px`
      container.style.display = "block"
    }

    const hideButton = () => {
      if (container) container.style.display = "none"
    }

    const handleSelectionChange = () => {
      if (!isEnabled) {
        hideButton()
        return
      }

      const selection = window.getSelection()
      const text = selection?.toString().trim()

      if (text && text.length > 0) {
        const range = selection?.getRangeAt(0)
        const rect = range?.getBoundingClientRect()

        if (rect) {
          selectionText = text
          showButton(
            rect.bottom + window.scrollY + 10,
            rect.right + window.scrollX - 30
          )
        }
      } else {
        hideButton()
      }
    }

    // Initial config load
    await updateConfig()
    ui.mount()

    // Listen for selection events
    document.addEventListener("mouseup", handleSelectionChange)
    document.addEventListener("keyup", handleSelectionChange)

    // Listen for storage changes to update isEnabled
    plasmoGlobalStorage.watch({
      [STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG]: (c) => {
        isEnabled =
          c.newValue?.showSelectionButton ??
          DEFAULT_CONTENT_EXTRACTION_CONFIG.showSelectionButton
        if (!isEnabled) hideButton()
      },
      [STORAGE_KEYS.LANGUAGE]: (c) => {
        currentLanguage = c.newValue || "en"
        if (container?.style.display === "block") renderButton()
      }
    })

    ctx.onInvalidated(() => {
      document.removeEventListener("mouseup", handleSelectionChange)
      document.removeEventListener("keyup", handleSelectionChange)
      ui.remove()
    })
  }
})

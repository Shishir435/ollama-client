import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ZustandPersistedStateSchema } from "@/types/ui-state.schemas"

export type ShortcutAction =
  | "newChat"
  | "focusInput"
  | "closeSidebar"
  | "stopGeneration"
  | "settings"
  | "toggleTheme"
  | "toggleRAG"
  | "toggleSpeech"
  | "toggleTabs"
  | "toggleSessionMetrics"
  | "searchMessages"
  | "clearChat"
  | "copyLastResponse"
  | "exportJson"
  | "exportMarkdown"
  | "exportPdf"
  | "exportText"

export interface Shortcut {
  id: ShortcutAction
  label: string
  description: string
  category: "navigation" | "actions" | "toggles"
  defaultKey: string
  key: string
}

interface ShortcutState {
  shortcuts: Record<ShortcutAction, Shortcut>
  updateShortcut: (action: ShortcutAction, key: string) => void
  resetShortcut: (action: ShortcutAction) => void
  resetShortcuts: () => void
  hasConflict: (
    key: string,
    excludeAction?: ShortcutAction
  ) => ShortcutAction | null
}

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, Shortcut> = {
  // Navigation
  focusInput: {
    id: "focusInput",
    label: "settings.shortcuts.focus_input",
    description: "settings.shortcuts.focus_input_desc",
    category: "navigation",
    defaultKey: "/",
    key: "/"
  },
  closeSidebar: {
    id: "closeSidebar",
    label: "settings.shortcuts.toggle_sidebar",
    description: "settings.shortcuts.toggle_sidebar_desc",
    category: "navigation",
    defaultKey: "Alt+B",
    key: "Alt+B"
  },
  settings: {
    id: "settings",
    label: "settings.shortcuts.open_settings",
    description: "settings.shortcuts.open_settings_desc",
    category: "navigation",
    defaultKey: "Alt+O",
    key: "Alt+O"
  },
  searchMessages: {
    id: "searchMessages",
    label: "settings.shortcuts.search_messages",
    description: "settings.shortcuts.search_messages_desc",
    category: "navigation",
    defaultKey: "Alt+F",
    key: "Alt+F"
  },

  // Actions
  newChat: {
    id: "newChat",
    label: "settings.shortcuts.new_chat",
    description: "settings.shortcuts.new_chat_desc",
    category: "actions",
    defaultKey: "Alt+N",
    key: "Alt+N"
  },
  stopGeneration: {
    id: "stopGeneration",
    label: "settings.shortcuts.stop_generation",
    description: "settings.shortcuts.stop_generation_desc",
    category: "actions",
    defaultKey: "Escape",
    key: "Escape"
  },
  clearChat: {
    id: "clearChat",
    label: "settings.shortcuts.clear_chat",
    description: "settings.shortcuts.clear_chat_desc",
    category: "actions",
    defaultKey: "Alt+X",
    key: "Alt+X"
  },
  copyLastResponse: {
    id: "copyLastResponse",
    label: "settings.shortcuts.copy_last_response",
    description: "settings.shortcuts.copy_last_response_desc",
    category: "actions",
    defaultKey: "Mod+Shift+C",
    key: "Mod+Shift+C"
  },
  exportJson: {
    id: "exportJson",
    label: "settings.shortcuts.export_json",
    description: "settings.shortcuts.export_json_desc",
    category: "actions",
    defaultKey: "Alt+J",
    key: "Alt+J"
  },
  exportMarkdown: {
    id: "exportMarkdown",
    label: "settings.shortcuts.export_markdown",
    description: "settings.shortcuts.export_markdown_desc",
    category: "actions",
    defaultKey: "Alt+M",
    key: "Alt+M"
  },
  exportPdf: {
    id: "exportPdf",
    label: "settings.shortcuts.export_pdf",
    description: "settings.shortcuts.export_pdf_desc",
    category: "actions",
    defaultKey: "Alt+P",
    key: "Alt+P"
  },
  exportText: {
    id: "exportText",
    label: "settings.shortcuts.export_text",
    description: "settings.shortcuts.export_text_desc",
    category: "actions",
    defaultKey: "Alt+Shift+T",
    key: "Alt+Shift+T"
  },

  // Toggles
  toggleTheme: {
    id: "toggleTheme",
    label: "settings.shortcuts.toggle_theme",
    description: "settings.shortcuts.toggle_theme_desc",
    category: "toggles",
    defaultKey: "Alt+T",
    key: "Alt+T"
  },
  toggleRAG: {
    id: "toggleRAG",
    label: "settings.shortcuts.toggle_rag",
    description: "settings.shortcuts.toggle_rag_desc",
    category: "toggles",
    defaultKey: "Alt+R",
    key: "Alt+R"
  },
  toggleSpeech: {
    id: "toggleSpeech",
    label: "settings.shortcuts.toggle_speech",
    description: "settings.shortcuts.toggle_speech_desc",
    category: "toggles",
    defaultKey: "Alt+S",
    key: "Alt+S"
  },
  toggleTabs: {
    id: "toggleTabs",
    label: "settings.shortcuts.toggle_tabs",
    description: "settings.shortcuts.toggle_tabs_desc",
    category: "toggles",
    defaultKey: "Alt+K",
    key: "Alt+K"
  },
  toggleSessionMetrics: {
    id: "toggleSessionMetrics",
    label: "settings.shortcuts.toggle_session_metrics",
    description: "settings.shortcuts.toggle_session_metrics_desc",
    category: "toggles",
    defaultKey: "Alt+M",
    key: "Alt+M"
  }
}

export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set, get) => ({
      shortcuts: DEFAULT_SHORTCUTS,
      updateShortcut: (action, key) =>
        set((state) => ({
          shortcuts: {
            ...state.shortcuts,
            [action]: {
              ...state.shortcuts[action],
              key
            }
          }
        })),
      resetShortcut: (action) =>
        set((state) => ({
          shortcuts: {
            ...state.shortcuts,
            [action]: {
              ...state.shortcuts[action],
              key: state.shortcuts[action].defaultKey
            }
          }
        })),
      resetShortcuts: () => set({ shortcuts: DEFAULT_SHORTCUTS }),
      hasConflict: (key, excludeAction) => {
        const { shortcuts } = get()
        for (const [action, shortcut] of Object.entries(shortcuts)) {
          if (shortcut.key === key && action !== excludeAction) {
            return action as ShortcutAction
          }
        }
        return null
      }
    }),
    {
      name: STORAGE_KEYS.SHORTCUTS,
      /*
       * Persist through `plasmoGlobalStorage` (chrome.storage.sync)
       * rather than Zustand's default `window.localStorage`. Three
       * reasons this matters in an extension:
       *
       *   1. window.localStorage is scoped per extension surface --
       *      values written from the options page aren't visible
       *      from the sidepanel or content scripts, so a user's
       *      custom keybinding doesn't take effect in the chat UI.
       *   2. window.localStorage doesn't exist in the background
       *      service worker context, so any code path that touches
       *      the store from there would throw on load.
       *   3. backup / export / "reset all data" all operate on
       *      chrome.storage. Shortcuts saved to localStorage are
       *      invisible to those flows.
       *
       * Mirrors the storage adapter pattern used by `theme.ts`.
       */
      storage: {
        getItem: async (name) => {
          const value = await plasmoGlobalStorage.get(name)
          if (value == null) return null
          if (typeof value === "string") {
            try {
              return JSON.parse(value)
            } catch {
              return null
            }
          }
          // Storage returned a pre-parsed object (chrome.storage does this)
          const parsed = ZustandPersistedStateSchema.safeParse(value)
          if (parsed.success) {
            return value as ReturnType<typeof JSON.parse>
          }
          return null
        },
        setItem: async (name, value) => {
          await plasmoGlobalStorage.set(name, value)
        },
        removeItem: async (name) => {
          await plasmoGlobalStorage.remove(name)
        }
      },
      // Merge persisted shortcuts with defaults to handle schema migrations
      // This ensures new shortcuts and fields (like category, description) are always present
      merge: (persisted, current) => {
        const persistedState = persisted as ShortcutState | undefined
        if (!persistedState?.shortcuts) {
          return current
        }

        // Merge each shortcut: keep user's key if exists, but use defaults for new fields
        const mergedShortcuts = { ...DEFAULT_SHORTCUTS }
        for (const [action, defaultShortcut] of Object.entries(
          DEFAULT_SHORTCUTS
        )) {
          const savedShortcut =
            persistedState.shortcuts[action as ShortcutAction]
          if (savedShortcut) {
            mergedShortcuts[action as ShortcutAction] = {
              ...defaultShortcut, // Use defaults for new fields (category, description, etc.)
              key: savedShortcut.key || defaultShortcut.key // Preserve user's custom key
            }
          }
        }

        return {
          ...current,
          shortcuts: mergedShortcuts
        }
      }
    }
  )
)

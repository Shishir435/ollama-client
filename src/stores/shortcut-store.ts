import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/lib/constants"

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
  | "searchMessages"
  | "clearChat"
  | "copyLastResponse"

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

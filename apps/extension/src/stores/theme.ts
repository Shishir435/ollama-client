import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ThemeState } from "@/types"

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme })
    }),
    {
      name: STORAGE_KEYS.THEME.PREFERENCE,
      storage: {
        getItem: async (name) => {
          const value = await plasmoGlobalStorage.get(name)
          return value ? JSON.parse(value) : null
        },
        setItem: async (name, value) => {
          await plasmoGlobalStorage.set(name, value)
        },
        removeItem: async (name) => {
          await plasmoGlobalStorage.remove(name)
        }
      }
    }
  )
)

// Listen for changes from other contexts (e.g. sidebar changing theme should update options page)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && changes[STORAGE_KEYS.THEME.PREFERENCE]) {
    const newValue = changes[STORAGE_KEYS.THEME.PREFERENCE].newValue
    if (newValue) {
      try {
        // Zustand persists as a stringified JSON object
        // We need to parse it to get the state
        const parsed =
          typeof newValue === "string" ? JSON.parse(newValue) : newValue

        if (parsed?.state?.theme) {
          useThemeStore.setState({ theme: parsed.state.theme })
        } else {
          // Fallback to rehydrate if structure doesn't match
          useThemeStore.persist.rehydrate()
        }
      } catch (e) {
        logger.error("Failed to sync theme", "themeStore", { error: e })
        useThemeStore.persist.rehydrate()
      }
    }
  }
})

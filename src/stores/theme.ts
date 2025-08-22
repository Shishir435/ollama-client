import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/lib/constants"
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

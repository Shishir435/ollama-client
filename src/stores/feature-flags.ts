import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

/**
 * Feature-flag / dark-ship scaffold (v0.11.0 groundwork — FEATURE_ROADMAP §5 item 5).
 *
 * Lets an in-progress 0.11.x feature merge DISABLED and flip on when ready, so the
 * big-PR cadence is not blocked on all-or-nothing merges. Every flag defaults to
 * `false` (dark). Foundation work (F1–F4) is not flagged — only user-facing epics.
 *
 * Add a flag here when its epic starts; remove it once the feature is stable and
 * unconditionally on. Persisted state is merged OVER defaults, so adding a new flag
 * never leaves an older persisted blob with an `undefined` entry.
 */

export const FEATURE_FLAG_DEFAULTS = {
  omnibox: false, // E6 — omnibox quick-ask
  bookmarksHistoryRag: false, // E2 — bookmarks/history local RAG
  perSiteProfiles: false, // E3 — per-site auto-context profiles
  tabGroups: false, // E4 — tab-group / multi-tab workflows
  artifactsCanvas: false, // E7 — artifacts / output canvas
  templateChaining: false, // E8 — prompt template variables + chaining
  downloads: false, // E9 — downloads for generated artifacts
  browserTools: false // E10 — browser actions as local tools
} as const

export type FeatureFlag = keyof typeof FEATURE_FLAG_DEFAULTS

interface FeatureFlagsState {
  flags: Record<FeatureFlag, boolean>
  setFlag: (flag: FeatureFlag, enabled: boolean) => void
  reset: () => void
}

export const useFeatureFlagsStore = create<FeatureFlagsState>()(
  persist(
    (set) => ({
      flags: { ...FEATURE_FLAG_DEFAULTS },
      setFlag: (flag, enabled) =>
        set((state) => ({ flags: { ...state.flags, [flag]: enabled } })),
      reset: () => set({ flags: { ...FEATURE_FLAG_DEFAULTS } })
    }),
    {
      name: STORAGE_KEYS.FEATURE_FLAGS,
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
          // chrome.storage returns pre-parsed objects — pass through directly
          // (mirrors the guard in shortcut-store.ts).
          return value as ReturnType<typeof JSON.parse>
        },
        setItem: async (name, value) => {
          await plasmoGlobalStorage.set(name, value)
        },
        removeItem: async (name) => {
          await plasmoGlobalStorage.remove(name)
        }
      },
      // Merge persisted flags over current defaults so newly-added flags appear
      // with their default rather than `undefined`.
      merge: (persisted, current) => {
        const p = persisted as Partial<FeatureFlagsState> | undefined
        return {
          ...current,
          flags: { ...FEATURE_FLAG_DEFAULTS, ...(p?.flags ?? {}) }
        }
      }
    }
  )
)

/** Reactive single-flag read for React components. */
export const useFeatureFlag = (flag: FeatureFlag): boolean =>
  useFeatureFlagsStore((state) => state.flags[flag])

/** Non-reactive read for background / non-React code. */
export const isFeatureEnabled = (flag: FeatureFlag): boolean =>
  useFeatureFlagsStore.getState().flags[flag]

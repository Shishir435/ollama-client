import { useEffect } from "react"
import { create } from "zustand"

interface UnsavedChangesState {
  /** Sources that currently hold edits no one has committed yet. */
  sources: Record<string, true>
  setDirty: (source: string, dirty: boolean) => void
  /** Forget every source; used once the user chose to discard. */
  clear: () => void
}

/**
 * Which settings surfaces hold uncommitted drafts, so the options page can
 * guard a tab switch or a closing window. Ephemeral by design: the drafts
 * themselves live with their owners and die with the page.
 */
export const useUnsavedChangesStore = create<UnsavedChangesState>((set) => ({
  sources: {},
  clear: () => set({ sources: {} }),
  setDirty: (source, dirty) =>
    set((state) => {
      if (Boolean(state.sources[source]) === dirty) return state
      const next = { ...state.sources }
      if (dirty) next[source] = true
      else delete next[source]
      return { sources: next }
    })
}))

export const hasUnsavedSettings = (): boolean =>
  Object.keys(useUnsavedChangesStore.getState().sources).length > 0

/** Report a draft's dirty state for the lifetime of the calling component. */
export const useReportUnsavedChanges = (
  source: string,
  dirty: boolean
): void => {
  const setDirty = useUnsavedChangesStore((state) => state.setDirty)
  useEffect(() => {
    setDirty(source, dirty)
    return () => setDirty(source, false)
  }, [source, dirty, setDirty])
}

/** Subscribe to whether any source is dirty. */
export const useHasUnsavedSettings = (): boolean =>
  useUnsavedChangesStore((state) => Object.keys(state.sources).length > 0)

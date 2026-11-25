import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

/** Text the user added from a page, waiting to be quoted into the next message. */
export interface SelectionContextItem {
  id: string
  text: string
  title?: string
  url?: string
}

/** More than this and the earliest is dropped: a message quotes a few passages, not a page. */
export const MAX_SELECTION_CONTEXT_ITEMS = 5

interface SelectionContextState {
  items: SelectionContextItem[]
  add: (item: SelectionContextItem) => void
  remove: (id: string) => void
  clear: () => void
}

/**
 * Ephemeral by design: what is staged is gone when the panel closes, the same
 * as text typed into the composer. Nothing here is persisted or synced.
 */
export const selectionContextStore = create<SelectionContextState>((set) => ({
  items: [],
  add: (item) =>
    set((state) => {
      // The same passage from the same page twice is one chip, and a delivery
      // seen again (storage change plus port message) must not double it.
      if (
        state.items.some(
          (existing) =>
            existing.id === item.id ||
            (existing.text === item.text && existing.url === item.url)
        )
      ) {
        return state
      }
      return {
        items: [...state.items, item].slice(-MAX_SELECTION_CONTEXT_ITEMS)
      }
    }),
  remove: (id) =>
    set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clear: () => set((state) => (state.items.length ? { items: [] } : state))
}))

export const useSelectionContext = () =>
  selectionContextStore(
    useShallow((state) => ({
      items: state.items,
      remove: state.remove,
      clear: state.clear
    }))
  )

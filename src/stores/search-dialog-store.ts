import { create } from "zustand"

interface SearchDialogState {
  isOpen: boolean
  /** Query to seed the dialog with when it opens (e.g. escalated from the
   * sidebar title filter). Empty for a cold open via the keyboard shortcut. */
  initialQuery: string
  openSearchDialog: (query?: string) => void
  closeSearchDialog: () => void
  toggleSearchDialog: () => void
}

export const useSearchDialogStore = create<SearchDialogState>((set) => ({
  isOpen: false,
  initialQuery: "",
  openSearchDialog: (query = "") => set({ isOpen: true, initialQuery: query }),
  // Clear initialQuery on every close/toggle so the next open never inherits a
  // query seeded by a prior sidebar escalation; openSearchDialog re-seeds it.
  closeSearchDialog: () => set({ isOpen: false, initialQuery: "" }),
  toggleSearchDialog: () =>
    set((state) => ({ isOpen: !state.isOpen, initialQuery: "" }))
}))

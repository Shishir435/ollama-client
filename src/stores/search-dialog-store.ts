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
  closeSearchDialog: () => set({ isOpen: false }),
  toggleSearchDialog: () => set((state) => ({ isOpen: !state.isOpen }))
}))

import { create } from "zustand"

interface SearchDialogState {
  isOpen: boolean
  openSearchDialog: () => void
  closeSearchDialog: () => void
  toggleSearchDialog: () => void
}

export const useSearchDialogStore = create<SearchDialogState>((set) => ({
  isOpen: false,
  openSearchDialog: () => set({ isOpen: true }),
  closeSearchDialog: () => set({ isOpen: false }),
  toggleSearchDialog: () => set((state) => ({ isOpen: !state.isOpen }))
}))

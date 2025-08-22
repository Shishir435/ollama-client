import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import type { SelectedTabsState } from "@/types"

export const useSelectedTabsStore = create<SelectedTabsState>((set) => ({
  selectedTabIds: [],
  errors: {},
  setSelectedTabIds: (tabs) => set({ selectedTabIds: tabs }),
  setErrors: (errors) => set({ errors })
}))

export const useSelectedTabs = () =>
  useSelectedTabsStore(
    useShallow((s) => ({
      selectedTabIds: s.selectedTabIds,
      setSelectedTabIds: s.setSelectedTabIds,
      errors: s.errors,
      setErrors: s.setErrors
    }))
  )

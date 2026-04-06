import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import type { LoadStreamState } from "@/types"

export const loadStreamStore = create<LoadStreamState>((set) => ({
  isLoading: false,
  isStreaming: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsStreaming: (streaming) => set({ isStreaming: streaming })
}))

export const useLoadStream = () => {
  return loadStreamStore(
    useShallow((s) => ({
      isLoading: s.isLoading,
      isStreaming: s.isStreaming,
      setIsLoading: s.setIsLoading,
      setIsStreaming: s.setIsStreaming
    }))
  )
}

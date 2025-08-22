import { create } from "zustand"

interface LoadStreamState {
  isLoading: boolean
  isStreaming: boolean
  setIsLoading: (loading: boolean) => void
  setIsStreaming: (streaming: boolean) => void
}

export const loadStreamStore = create<LoadStreamState>((set) => ({
  isLoading: false,
  isStreaming: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  setIsStreaming: (streaming) => set({ isStreaming: streaming })
}))

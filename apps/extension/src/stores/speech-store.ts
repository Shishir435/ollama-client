import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/lib/constants"

interface SpeechState {
  autoPlayEnabled: boolean
  toggleAutoPlay: () => void
  setAutoPlay: (enabled: boolean) => void
}

export const useSpeechStore = create<SpeechState>()(
  persist(
    (set) => ({
      autoPlayEnabled: false,
      toggleAutoPlay: () =>
        set((state) => ({ autoPlayEnabled: !state.autoPlayEnabled })),
      setAutoPlay: (enabled) => set({ autoPlayEnabled: enabled })
    }),
    {
      name: STORAGE_KEYS.TTS.AUTO_PLAY
    }
  )
)

import { create } from "zustand"

interface SpeechState {
  speakingText: string | null
  setSpeakingText: (text: string | null) => void
}

export const useSpeechStore = create<SpeechState>((set) => ({
  speakingText: null,
  setSpeakingText: (speakingText) => set({ speakingText })
}))

import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useSpeechSynthesis } from "../use-speech-synthesis"

// --- Utterance mock ---
type UtteranceHandlers = {
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

let lastUtterance:
  | (UtteranceHandlers & {
      text: string
      rate: number
      pitch: number
      voice: SpeechSynthesisVoice | null
    })
  | null = null

class MockUtterance implements UtteranceHandlers {
  text: string
  rate = 1
  pitch = 1
  lang = ""
  voice: SpeechSynthesisVoice | null = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(text: string) {
    this.text = text
    lastUtterance = this
  }
}

// --- SpeechSynthesis mock ---
const mockSynth = {
  speaking: false,
  speak: vi.fn(),
  cancel: vi.fn()
}

// --- Store mock ---
const mockSetSpeakingText = vi.fn()
let mockSpeakingText: string | null = null

vi.mock("@/features/chat/stores/speech-store", () => ({
  useSpeechStore: () => ({
    get speakingText() {
      return mockSpeakingText
    },
    setSpeakingText: mockSetSpeakingText
  })
}))

const mockVoice = {
  voiceURI: "voice-en",
  name: "English"
} as SpeechSynthesisVoice

vi.mock("@/features/chat/hooks/use-voice", () => ({
  useVoices: () => ({ voices: [mockVoice], isLoading: false })
}))

vi.mock("@/features/chat/hooks/use-speech-settings", () => ({
  useSpeechSettings: () => ({ rate: 1.2, pitch: 0.9, voiceURI: "voice-en" })
}))

vi.mock("@/lib/text-utils", () => ({
  markdownToSpeechText: (text: string) => text.replace(/\*\*/g, "")
}))

beforeEach(() => {
  vi.clearAllMocks()
  lastUtterance = null
  mockSpeakingText = null
  mockSynth.speaking = false
  global.SpeechSynthesisUtterance = MockUtterance as never
  Object.defineProperty(window, "speechSynthesis", {
    value: mockSynth,
    configurable: true,
    writable: true
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useSpeechSynthesis", () => {
  it("calls speechSynthesis.speak with a stripped utterance", async () => {
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.speak("Hello **world**")
    })

    expect(mockSynth.speak).toHaveBeenCalledOnce()
    expect(lastUtterance?.text).toBe("Hello world")
  })

  it("applies rate, pitch and matched voice to utterance", async () => {
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.speak("Test")
    })

    expect(lastUtterance?.rate).toBe(1.2)
    expect(lastUtterance?.pitch).toBe(0.9)
    expect(lastUtterance?.voice).toBe(mockVoice)
  })

  it("does not speak when speakingText is already set", async () => {
    mockSpeakingText = "already speaking"
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.speak("New text")
    })

    expect(mockSynth.speak).not.toHaveBeenCalled()
  })

  it("cancels existing speech before starting new utterance", async () => {
    mockSynth.speaking = true
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.speak("New text")
    })

    expect(mockSynth.cancel).toHaveBeenCalledOnce()
    expect(mockSynth.speak).toHaveBeenCalledOnce()
  })

  it("utterance.onstart sets speakingText to the markdown input", async () => {
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.speak("Hello")
    })

    lastUtterance?.onstart?.()
    expect(mockSetSpeakingText).toHaveBeenCalledWith("Hello")
  })

  it("utterance.onend clears speakingText", async () => {
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.speak("Hello")
    })

    lastUtterance?.onend?.()
    expect(mockSetSpeakingText).toHaveBeenCalledWith(null)
  })

  it("utterance.onerror clears speakingText", async () => {
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.speak("Hello")
    })

    lastUtterance?.onerror?.()
    expect(mockSetSpeakingText).toHaveBeenCalledWith(null)
  })

  it("stop() cancels synthesis and clears speakingText when speaking", async () => {
    mockSynth.speaking = true
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.stop()
    })

    expect(mockSynth.cancel).toHaveBeenCalledOnce()
    expect(mockSetSpeakingText).toHaveBeenCalledWith(null)
  })

  it("stop() does nothing when synthesis is not speaking", async () => {
    mockSynth.speaking = false
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.stop()
    })

    expect(mockSynth.cancel).not.toHaveBeenCalled()
  })

  it("toggle() stops when speakingText matches the argument", async () => {
    mockSpeakingText = "current text"
    mockSynth.speaking = true
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.toggle("current text")
    })

    expect(mockSynth.cancel).toHaveBeenCalledOnce()
  })

  it("toggle() speaks when speakingText does not match", async () => {
    mockSpeakingText = null
    const { result } = renderHook(() => useSpeechSynthesis())

    await act(async () => {
      result.current.toggle("new text")
    })

    expect(mockSynth.speak).toHaveBeenCalledOnce()
  })

  it("cancels speech on unmount", () => {
    const { unmount } = renderHook(() => useSpeechSynthesis())
    unmount()
    expect(mockSynth.cancel).toHaveBeenCalledOnce()
  })

  it("exposes speakingText, isLoadingVoices, and voices from store/hook", () => {
    mockSpeakingText = "reading..."
    const { result } = renderHook(() => useSpeechSynthesis())

    expect(result.current.speakingText).toBe("reading...")
    expect(result.current.isLoadingVoices).toBe(false)
    expect(result.current.voices).toContain(mockVoice)
  })
})

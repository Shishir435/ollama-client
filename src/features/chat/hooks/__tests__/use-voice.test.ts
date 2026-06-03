import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useVoices } from "../use-voice"

const makeVoice = (uri: string): SpeechSynthesisVoice =>
  ({
    voiceURI: uri,
    name: uri,
    lang: "en-US",
    localService: true,
    default: false
  }) as SpeechSynthesisVoice

const mockSpeechSynthesis = {
  getVoices: vi.fn<() => SpeechSynthesisVoice[]>(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockSpeechSynthesis.getVoices.mockReturnValue([])
  Object.defineProperty(window, "speechSynthesis", {
    value: mockSpeechSynthesis,
    configurable: true,
    writable: true
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useVoices", () => {
  it("starts with isLoading=true and empty voices list", () => {
    const { result } = renderHook(() => useVoices())
    expect(result.current.isLoading).toBe(true)
    expect(result.current.voices).toHaveLength(0)
  })

  it("populates voices immediately when getVoices returns results on mount", async () => {
    mockSpeechSynthesis.getVoices.mockReturnValue([
      makeVoice("voice-a"),
      makeVoice("voice-b")
    ])

    const { result } = renderHook(() => useVoices())

    await act(async () => {})

    expect(result.current.voices).toHaveLength(2)
    expect(result.current.isLoading).toBe(false)
  })

  it("loads voices via 100ms timeout fallback when initially empty", async () => {
    mockSpeechSynthesis.getVoices
      .mockReturnValueOnce([])
      .mockReturnValue([makeVoice("delayed-voice")])

    const { result } = renderHook(() => useVoices())

    expect(result.current.voices).toHaveLength(0)

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.voices).toHaveLength(1)
    expect(result.current.voices[0].voiceURI).toBe("delayed-voice")
    expect(result.current.isLoading).toBe(false)
  })

  it("registers voiceschanged event listener on mount", () => {
    renderHook(() => useVoices())
    expect(mockSpeechSynthesis.addEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function)
    )
  })

  it("removes voiceschanged listener on unmount", () => {
    const { unmount } = renderHook(() => useVoices())
    unmount()
    expect(mockSpeechSynthesis.removeEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function)
    )
  })

  it("updates voices when voiceschanged fires", async () => {
    const { result } = renderHook(() => useVoices())

    const [, listener] =
      mockSpeechSynthesis.addEventListener.mock.calls.find(
        ([event]) => event === "voiceschanged"
      ) ?? []
    expect(listener).toBeDefined()

    mockSpeechSynthesis.getVoices.mockReturnValue([makeVoice("new-voice")])

    await act(async () => {
      listener()
    })

    expect(result.current.voices).toHaveLength(1)
    expect(result.current.voices[0].voiceURI).toBe("new-voice")
  })

  it("does not duplicate state update when voice list is unchanged", async () => {
    const voice = makeVoice("stable-voice")
    mockSpeechSynthesis.getVoices.mockReturnValue([voice])

    const { result } = renderHook(() => useVoices())

    await act(async () => {})
    const firstRef = result.current.voices

    const [, listener] =
      mockSpeechSynthesis.addEventListener.mock.calls.find(
        ([event]) => event === "voiceschanged"
      ) ?? []

    await act(async () => {
      listener()
    })

    // Same URIs → same reference (no re-render triggered by the setter)
    expect(result.current.voices).toHaveLength(1)
    expect(firstRef).toBe(result.current.voices)
  })
})

import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  isSpeechRecognitionSupported,
  useSpeechRecognition
} from "../use-speech-recognition"

class FakeRecognition {
  lang = ""
  continuous = false
  interimResults = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()

  emitFinal(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript } } }
    })
  }
}

afterEach(() => {
  delete (window as any).SpeechRecognition
  delete (window as any).webkitSpeechRecognition
  vi.restoreAllMocks()
})

describe("useSpeechRecognition", () => {
  it("reports unsupported when no recognition API is present", () => {
    expect(isSpeechRecognitionSupported()).toBe(false)
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))
    expect(result.current.supported).toBe(false)
  })

  it("starts listening and forwards the final transcript", () => {
    const instances: FakeRecognition[] = []
    ;(window as any).SpeechRecognition = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
    }
    const onTranscript = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition(onTranscript))

    expect(result.current.supported).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.listening).toBe(true)
    expect(instances[0].start).toHaveBeenCalled()

    act(() => instances[0].emitFinal("hello world"))
    expect(onTranscript).toHaveBeenCalledWith("hello world")
  })

  it("stops when toggled while listening", () => {
    const instances: FakeRecognition[] = []
    ;(window as any).webkitSpeechRecognition = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
    }
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    act(() => result.current.toggle())
    expect(result.current.listening).toBe(true)
    act(() => result.current.toggle())
    expect(instances[0].stop).toHaveBeenCalled()
    expect(result.current.listening).toBe(false)
  })
})

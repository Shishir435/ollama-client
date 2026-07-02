import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

// happy-dom exposes navigator.permissions/mediaDevices as getter-only —
// override via defineProperty and restore by redefining as undefined.
const defineNav = (prop: string, value: unknown) => {
  Object.defineProperty(navigator, prop, { value, configurable: true })
}

const grantMic = () => {
  defineNav("permissions", {
    query: vi.fn().mockResolvedValue({ state: "granted" })
  })
}

const denyMic = () => {
  defineNav("permissions", {
    query: vi.fn().mockResolvedValue({ state: "prompt" })
  })
  defineNav("mediaDevices", {
    getUserMedia: vi.fn().mockRejectedValue(new Error("NotAllowedError"))
  })
}

beforeEach(() => {
  grantMic()
})

afterEach(() => {
  delete (window as any).SpeechRecognition
  delete (window as any).webkitSpeechRecognition
  defineNav("permissions", undefined)
  defineNav("mediaDevices", undefined)
  vi.restoreAllMocks()
})

describe("useSpeechRecognition", () => {
  it("reports unsupported when no recognition API is present", () => {
    expect(isSpeechRecognitionSupported()).toBe(false)
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))
    expect(result.current.supported).toBe(false)
  })

  it("starts listening and forwards the final transcript", async () => {
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
    await act(async () => result.current.toggle())
    expect(result.current.listening).toBe(true)
    expect(instances[0].start).toHaveBeenCalled()

    act(() => instances[0].emitFinal("hello world"))
    expect(onTranscript).toHaveBeenCalledWith("hello world")
  })

  it("stops when toggled while listening", async () => {
    const instances: FakeRecognition[] = []
    ;(window as any).webkitSpeechRecognition = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
    }
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    await act(async () => result.current.toggle())
    expect(result.current.listening).toBe(true)
    await act(async () => result.current.toggle())
    expect(instances[0].stop).toHaveBeenCalled()
    expect(result.current.listening).toBe(false)
  })

  it("requests mic permission via getUserMedia when not yet granted", async () => {
    const stop = vi.fn()
    defineNav("permissions", {
      query: vi.fn().mockResolvedValue({ state: "prompt" })
    })
    const getUserMedia = vi
      .fn()
      .mockResolvedValue({ getTracks: () => [{ stop }] })
    defineNav("mediaDevices", { getUserMedia })

    const instances: FakeRecognition[] = []
    ;(window as any).SpeechRecognition = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
    }
    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))

    await act(async () => result.current.toggle())

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(stop).toHaveBeenCalled()
    expect(result.current.listening).toBe(true)
  })

  it("reports not-allowed instead of starting when mic access is denied", async () => {
    denyMic()
    const instances: FakeRecognition[] = []
    ;(window as any).SpeechRecognition = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
    }
    const onError = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition(vi.fn(), onError))

    await act(async () => result.current.toggle())

    expect(onError).toHaveBeenCalledWith("not-allowed")
    expect(result.current.listening).toBe(false)
    expect(instances).toHaveLength(0)
  })

  it("prefers on-device recognition when available", async () => {
    const instances: FakeRecognition[] = []
    const ctor = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
      static available = vi.fn().mockResolvedValue("available")
      static install = vi.fn()
    }
    ;(window as any).SpeechRecognition = ctor

    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))
    await act(async () => result.current.toggle())

    expect(ctor.available).toHaveBeenCalledWith(
      expect.objectContaining({ processLocally: true })
    )
    expect((instances[0] as any).processLocally).toBe(true)
    expect(ctor.install).not.toHaveBeenCalled()
    expect(result.current.listening).toBe(true)
  })

  it("installs the language pack once, notifies, then starts locally", async () => {
    const instances: FakeRecognition[] = []
    const ctor = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
      static available = vi.fn().mockResolvedValue("downloadable")
      static install = vi.fn().mockResolvedValue(true)
    }
    ;(window as any).SpeechRecognition = ctor
    const onNotice = vi.fn()

    const { result } = renderHook(() =>
      useSpeechRecognition(vi.fn(), undefined, onNotice)
    )
    await act(async () => result.current.toggle())

    expect(onNotice).toHaveBeenCalledWith("local-model-downloading")
    expect(ctor.install).toHaveBeenCalled()
    expect((instances[0] as any).processLocally).toBe(true)
    expect(result.current.listening).toBe(true)
  })

  it("waits instead of starting a doomed cloud session while downloading", async () => {
    const ctor = class extends FakeRecognition {
      static available = vi.fn().mockResolvedValue("downloading")
    }
    ;(window as any).SpeechRecognition = ctor
    const onNotice = vi.fn()

    const { result } = renderHook(() =>
      useSpeechRecognition(vi.fn(), undefined, onNotice)
    )
    await act(async () => result.current.toggle())

    expect(onNotice).toHaveBeenCalledWith("local-model-downloading")
    expect(result.current.listening).toBe(false)
  })

  it("falls back to cloud when on-device is unavailable", async () => {
    const instances: FakeRecognition[] = []
    const ctor = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
      static available = vi.fn().mockResolvedValue("unavailable")
    }
    ;(window as any).SpeechRecognition = ctor

    const { result } = renderHook(() => useSpeechRecognition(vi.fn()))
    await act(async () => result.current.toggle())

    expect((instances[0] as any).processLocally).toBeUndefined()
    expect(result.current.listening).toBe(true)
  })

  it("surfaces recognition errors except aborted and no-speech", async () => {
    const instances: FakeRecognition[] = []
    ;(window as any).SpeechRecognition = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
    }
    const onError = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition(vi.fn(), onError))

    await act(async () => result.current.toggle())
    act(() => instances[0].onerror?.({ error: "network" }))
    expect(onError).toHaveBeenCalledWith("network")

    onError.mockClear()
    await act(async () => {
      instances[0].onend?.()
    })
    await act(async () => result.current.toggle())
    act(() => instances[1].onerror?.({ error: "no-speech" }))
    act(() => instances[1].onerror?.({ error: "aborted" }))
    expect(onError).not.toHaveBeenCalled()
  })
})

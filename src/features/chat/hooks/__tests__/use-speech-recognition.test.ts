import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  INITIAL_SILENCE_MS,
  isSpeechRecognitionSupported,
  PREPARE_POLL_MS,
  SILENCE_STOP_MS,
  useSpeechRecognition
} from "../use-speech-recognition"

class FakeRecognition {
  lang = ""
  continuous = false
  interimResults = false
  processLocally?: boolean
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => this.onend?.())
  abort = vi.fn()

  emit(
    parts: Array<{ transcript: string; isFinal: boolean }>,
    resultIndex = 0
  ) {
    const results: Record<number, unknown> & { length: number } = {
      length: parts.length
    }
    parts.forEach((part, i) => {
      results[i] = {
        isFinal: part.isFinal,
        length: 1,
        0: { transcript: part.transcript }
      }
    })
    this.onresult?.({ resultIndex, results })
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

const installCtor = () => {
  const instances: FakeRecognition[] = []
  ;(window as any).SpeechRecognition = class extends FakeRecognition {
    constructor() {
      super()
      instances.push(this)
    }
  }
  return instances
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
  vi.useRealTimers()
})

describe("useSpeechRecognition", () => {
  it("reports unsupported when no recognition API is present", () => {
    expect(isSpeechRecognitionSupported()).toBe(false)
    const { result } = renderHook(() => useSpeechRecognition({}))
    expect(result.current.supported).toBe(false)
  })

  it("reports unsupported in Brave", async () => {
    installCtor()
    defineNav("brave", { isBrave: vi.fn().mockResolvedValue(true) })
    const { result } = renderHook(() => useSpeechRecognition({}))
    await act(async () => {})
    expect(result.current.supported).toBe(false)
    defineNav("brave", undefined)
  })

  it("streams live transcripts and commits the final text on end", async () => {
    const instances = installCtor()
    const onLive = vi.fn()
    const onFinal = vi.fn()
    const { result } = renderHook(() =>
      useSpeechRecognition({
        onLiveTranscript: onLive,
        onFinalTranscript: onFinal
      })
    )

    await act(async () => result.current.toggle())
    const rec = instances[0]
    expect(rec.continuous).toBe(true)
    expect(rec.interimResults).toBe(true)
    expect(result.current.listening).toBe(true)

    act(() => rec.emit([{ transcript: "hello wor", isFinal: false }]))
    expect(onLive).toHaveBeenLastCalledWith("", "hello wor")

    act(() => rec.emit([{ transcript: "hello world", isFinal: true }]))
    expect(onLive).toHaveBeenLastCalledWith("hello world", "")

    act(() =>
      rec.emit(
        [
          { transcript: "hello world", isFinal: true },
          { transcript: " how are you", isFinal: false }
        ],
        1
      )
    )
    expect(onLive).toHaveBeenLastCalledWith("hello world", "how are you")

    act(() => rec.stop())
    expect(onFinal).toHaveBeenCalledWith("hello world")
    expect(result.current.listening).toBe(false)
  })

  it("auto-stops after the silence window", async () => {
    vi.useFakeTimers()
    const instances = installCtor()
    const { result } = renderHook(() => useSpeechRecognition({}))

    await act(async () => result.current.toggle())
    const rec = instances[0]

    act(() => rec.emit([{ transcript: "hi", isFinal: true }]))
    expect(rec.stop).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(SILENCE_STOP_MS + 10))
    expect(rec.stop).toHaveBeenCalled()
    expect(result.current.listening).toBe(false)
  })

  it("allows a longer grace period before the first speech", async () => {
    vi.useFakeTimers()
    const instances = installCtor()
    const { result } = renderHook(() => useSpeechRecognition({}))

    await act(async () => result.current.toggle())
    const rec = instances[0]

    act(() => vi.advanceTimersByTime(SILENCE_STOP_MS + 10))
    expect(rec.stop).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(INITIAL_SILENCE_MS))
    expect(rec.stop).toHaveBeenCalled()
  })

  it("stops dictation when the user starts typing", async () => {
    const instances = installCtor()
    const { result } = renderHook(() => useSpeechRecognition({}))

    await act(async () => result.current.toggle())
    const rec = instances[0]

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }))
    })
    expect(rec.stop).toHaveBeenCalled()
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
    installCtor()

    const { result } = renderHook(() => useSpeechRecognition({}))
    await act(async () => result.current.toggle())

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(stop).toHaveBeenCalled()
    expect(result.current.listening).toBe(true)
  })

  it("reports not-allowed instead of starting when mic access is denied", async () => {
    defineNav("permissions", {
      query: vi.fn().mockResolvedValue({ state: "prompt" })
    })
    defineNav("mediaDevices", {
      getUserMedia: vi.fn().mockRejectedValue(new Error("NotAllowedError"))
    })
    const instances = installCtor()
    const onError = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onError }))

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

    const { result } = renderHook(() => useSpeechRecognition({}))
    await act(async () => result.current.toggle())

    expect(ctor.available).toHaveBeenCalledWith(
      expect.objectContaining({ processLocally: true })
    )
    expect(instances[0].processLocally).toBe(true)
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

    const { result } = renderHook(() => useSpeechRecognition({ onNotice }))
    await act(async () => result.current.toggle())

    expect(onNotice).toHaveBeenCalledWith("local-model-downloading")
    expect(ctor.install).toHaveBeenCalled()
    expect(instances[0].processLocally).toBe(true)
    expect(result.current.listening).toBe(true)
  })

  it("exposes preparing while the language pack installs", async () => {
    const instances: FakeRecognition[] = []
    let resolveInstall: (v: boolean) => void = () => {}
    const ctor = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
      static available = vi.fn().mockResolvedValue("downloadable")
      static install = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveInstall = resolve
          })
      )
    }
    ;(window as any).SpeechRecognition = ctor

    const { result } = renderHook(() => useSpeechRecognition({}))
    let togglePromise: unknown
    await act(async () => {
      togglePromise = result.current.toggle()
    })
    expect(result.current.preparing).toBe(true)
    expect(result.current.listening).toBe(false)

    await act(async () => {
      resolveInstall(true)
      await togglePromise
    })
    expect(result.current.preparing).toBe(false)
    expect(instances[0].processLocally).toBe(true)
    expect(result.current.listening).toBe(true)
  })

  it("polls availability during an in-flight download and auto-starts", async () => {
    vi.useFakeTimers()
    const instances: FakeRecognition[] = []
    const available = vi
      .fn()
      .mockResolvedValueOnce("downloading")
      .mockResolvedValueOnce("downloading")
      .mockResolvedValue("available")
    const ctor = class extends FakeRecognition {
      constructor() {
        super()
        instances.push(this)
      }
      static available = available
    }
    ;(window as any).SpeechRecognition = ctor
    const onNotice = vi.fn()

    const { result } = renderHook(() => useSpeechRecognition({ onNotice }))
    let togglePromise: Promise<unknown> | undefined
    await act(async () => {
      togglePromise = result.current.toggle() as unknown as Promise<unknown>
      await Promise.resolve()
    })
    expect(onNotice).toHaveBeenCalledWith("local-model-downloading")
    expect(result.current.preparing).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREPARE_POLL_MS * 3)
      await togglePromise
    })
    expect(result.current.preparing).toBe(false)
    expect(instances[0]?.processLocally).toBe(true)
    expect(result.current.listening).toBe(true)
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

    const { result } = renderHook(() => useSpeechRecognition({}))
    await act(async () => result.current.toggle())

    expect(instances[0].processLocally).toBeUndefined()
    expect(result.current.listening).toBe(true)
  })

  it("surfaces recognition errors except aborted and no-speech", async () => {
    const instances = installCtor()
    const onError = vi.fn()
    const { result } = renderHook(() => useSpeechRecognition({ onError }))

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

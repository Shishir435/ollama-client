import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Minimal Web Speech `SpeechRecognition` shape. Typed locally (not as a global
 * augmentation) to avoid clashing with lib.dom across TS versions; the vendor
 * prefix means it is not reliably present in the standard lib types anyway.
 */
interface SpeechRecognitionAlternative {
  readonly transcript: string
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: SpeechRecognitionAlternative
}
interface SpeechRecognitionResultList {
  readonly length: number
  readonly [index: number]: SpeechRecognitionResultLike
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  /** Chrome 139+: force on-device recognition (no audio leaves the machine). */
  processLocally?: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionAvailabilityOptions {
  langs: string[]
  processLocally?: boolean
}

/** Chrome 139+ static methods for on-device recognition. */
interface SpeechRecognitionStatics {
  available?: (
    options: SpeechRecognitionAvailabilityOptions
  ) => Promise<"available" | "downloadable" | "downloading" | "unavailable">
  install?: (options: SpeechRecognitionAvailabilityOptions) => Promise<boolean>
}

type SpeechRecognitionConstructor = (new () => SpeechRecognitionLike) &
  SpeechRecognitionStatics

interface SpeechCapableWindow {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

const getRecognitionCtor = (): SpeechRecognitionConstructor | undefined => {
  if (typeof window === "undefined") return undefined
  const w = window as unknown as SpeechCapableWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/** How often to re-poll `available()` while a language pack downloads. */
export const PREPARE_POLL_MS = 1500
/** Give up waiting on a language-pack download after this long. */
export const PREPARE_TIMEOUT_MS = 5 * 60_000

/**
 * Decide whether this session can run on-device (Chrome 139+ `processLocally`).
 *
 * On-device is strongly preferred: it is the private option, and the cloud
 * recognizer rejects extension pages with a "network" error in many Chrome
 * builds, so it is often the only working option. First use may need a
 * one-time language-pack download. `install()` exposes no progress events, so
 * the best trackable signal is phase, not percent: `onPreparing` marks the
 * download window (indeterminate spinner), and `available()` is re-polled
 * until the pack lands — the caller then starts dictation automatically.
 */
const resolveLocalProcessing = async (
  Ctor: SpeechRecognitionConstructor,
  lang: string,
  onNotice: ((code: string) => void) | undefined,
  onPreparing: (preparing: boolean) => void,
  isDisposed: () => boolean
): Promise<"local" | "cloud" | "wait"> => {
  if (!Ctor.available) return "cloud"
  try {
    const options = { langs: [lang], processLocally: true }
    let status = await Ctor.available(options)
    if (status === "available") return "local"

    if (status === "downloadable" && Ctor.install) {
      onNotice?.("local-model-downloading")
      onPreparing(true)
      try {
        const installed = await Promise.race([
          Ctor.install(options),
          sleep(PREPARE_TIMEOUT_MS).then(() => "timeout" as const)
        ])
        if (installed === true) return "local"
        if (installed === false) return "cloud"
        return "wait"
      } finally {
        onPreparing(false)
      }
    }

    if (status === "downloading") {
      // A download is already in flight (earlier click, other window). No
      // progress API exists — poll availability and start once it lands.
      onNotice?.("local-model-downloading")
      onPreparing(true)
      try {
        const deadline = Date.now() + PREPARE_TIMEOUT_MS
        while (Date.now() < deadline && !isDisposed()) {
          await sleep(PREPARE_POLL_MS)
          status = await Ctor.available(options)
          if (status === "available") return "local"
          if (status !== "downloading") return "cloud"
        }
        return "wait"
      } finally {
        onPreparing(false)
      }
    }
  } catch {
    // Fall through to cloud recognition.
  }
  return "cloud"
}

/** True when the browser exposes Web Speech recognition (Chromium; not Firefox). */
export const isSpeechRecognitionSupported = (): boolean =>
  getRecognitionCtor() !== undefined

/**
 * Ensure the extension origin has microphone access before starting
 * recognition. `SpeechRecognition.start()` fails with "not-allowed" without
 * ever showing a permission prompt — only `getUserMedia` triggers the prompt
 * on a chrome-extension page. The acquired tracks are released immediately;
 * this is purely a permission handshake.
 */
const ensureMicPermission = async (): Promise<boolean> => {
  try {
    const status = await navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .catch(() => undefined)
    if (status?.state === "granted") return true

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    return true
  } catch {
    return false
  }
}

/**
 * Voice-to-text for the composer. Toggles a one-shot recognition session and
 * calls `onTranscript` with the final text. Degrades to `supported: false` where
 * the API is missing so the caller can hide the control. Failures are reported
 * through `onError` with the Web Speech error code ("not-allowed", "network",
 * "no-speech", …) so the UI can explain instead of silently resetting.
 *
 * Dictation model (chat-app style): a session is continuous with interim
 * results streamed through `onLiveTranscript(finalText, interimText)`; it
 * ends on mic toggle, on any keydown (the user resumed typing), or after a
 * silence window — `INITIAL_SILENCE_MS` before the first speech,
 * `SILENCE_STOP_MS` after it. The full final transcript arrives once via
 * `onFinalTranscript` when the session ends.
 */
export const INITIAL_SILENCE_MS = 7000
export const SILENCE_STOP_MS = 2500

export interface UseSpeechRecognitionCallbacks {
  /** Streaming update: committed text so far + current interim hypothesis. */
  onLiveTranscript?: (finalText: string, interimText: string) => void
  /** Fires once when the session ends, with the committed transcript. */
  onFinalTranscript?: (text: string) => void
  onError?: (code: string) => void
  onNotice?: (code: string) => void
}

type TimerRef = { current: ReturnType<typeof setTimeout> | null }

const clearSilenceTimer = (ref: TimerRef) => {
  if (ref.current) {
    clearTimeout(ref.current)
    ref.current = null
  }
}

/** Brave disables the cloud recognizer and its on-device install hangs. */
const isBraveBrowser = async (): Promise<boolean> => {
  const brave = (
    navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } }
  ).brave
  try {
    return (await brave?.isBrave?.()) ?? false
  } catch {
    return false
  }
}

export const useSpeechRecognition = ({
  onLiveTranscript,
  onFinalTranscript,
  onError,
  onNotice
}: UseSpeechRecognitionCallbacks) => {
  const [supported, setSupported] = useState(isSpeechRecognitionSupported())
  const [listening, setListening] = useState(false)
  // True while a language-pack download is pending. The API has no percent
  // progress, so this drives an indeterminate spinner.
  const [preparing, setPreparing] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposedRef = useRef(false)
  const callbacksRef = useRef({
    onLiveTranscript,
    onFinalTranscript,
    onError,
    onNotice
  })
  callbacksRef.current = {
    onLiveTranscript,
    onFinalTranscript,
    onError,
    onNotice
  }

  // Web Speech never works in Brave (cloud keys stripped, on-device install
  // hangs) — hide the control there instead of failing on click.
  useEffect(() => {
    let cancelled = false
    void isBraveBrowser().then((brave) => {
      if (brave && !cancelled) setSupported(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(async () => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || recognitionRef.current) return

    if (!(await ensureMicPermission())) {
      callbacksRef.current.onError?.("not-allowed")
      return
    }

    const lang =
      typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US"
    const mode = await resolveLocalProcessing(
      Ctor,
      lang,
      (code) => callbacksRef.current.onNotice?.(code),
      setPreparing,
      () => disposedRef.current
    )
    if (mode === "wait" || disposedRef.current) return
    // A second click while the permission prompt or language-pack download
    // was pending could have started another session in the meantime.
    if (recognitionRef.current) return

    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true
    if (mode === "local") recognition.processLocally = true

    let committed = ""

    const armSilenceTimer = (ms: number) => {
      clearSilenceTimer(silenceTimerRef)
      silenceTimerRef.current = setTimeout(() => recognition.stop(), ms)
    }

    recognition.onresult = (event) => {
      let interim = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result?.[0]?.transcript ?? ""
        if (result?.isFinal) {
          const trimmed = transcript.trim()
          if (trimmed)
            committed = committed ? `${committed} ${trimmed}` : trimmed
        } else {
          interim += transcript
        }
      }
      callbacksRef.current.onLiveTranscript?.(committed, interim.trim())
      armSilenceTimer(SILENCE_STOP_MS)
    }
    recognition.onerror = (event) => {
      setListening(false)
      // "aborted" is the user/unmount cancelling; "no-speech" self-explains
      // by the session just ending — neither warrants an error surface.
      if (event.error !== "aborted" && event.error !== "no-speech") {
        callbacksRef.current.onError?.(event.error)
      }
    }
    recognition.onend = () => {
      clearSilenceTimer(silenceTimerRef)
      document.removeEventListener("keydown", stopOnKeydown, true)
      setListening(false)
      recognitionRef.current = null
      callbacksRef.current.onFinalTranscript?.(committed)
    }

    // The user going back to the keyboard ends dictation (chat-app behavior).
    const stopOnKeydown = () => recognition.stop()
    document.addEventListener("keydown", stopOnKeydown, true)

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
    armSilenceTimer(INITIAL_SILENCE_MS)
  }, [])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  // Abort any in-flight session on unmount so the mic is released.
  useEffect(
    () => () => {
      disposedRef.current = true
      clearSilenceTimer(silenceTimerRef)
      recognitionRef.current?.abort()
    },
    []
  )

  return { supported, listening, preparing, toggle }
}

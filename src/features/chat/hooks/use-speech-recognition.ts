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
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

interface SpeechCapableWindow {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

const getRecognitionCtor = (): SpeechRecognitionConstructor | undefined => {
  if (typeof window === "undefined") return undefined
  const w = window as unknown as SpeechCapableWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
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
 */
export const useSpeechRecognition = (
  onTranscript: (text: string) => void,
  onError?: (code: string) => void
) => {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(async () => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || recognitionRef.current) return

    if (!(await ensureMicPermission())) {
      onErrorRef.current?.("not-allowed")
      return
    }
    // A second click while the permission prompt was open could have started
    // another session in the meantime.
    if (recognitionRef.current) return

    const recognition = new Ctor()
    recognition.lang =
      typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US"
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onresult = (event) => {
      let finalText = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result?.isFinal) finalText += result[0]?.transcript ?? ""
      }
      const trimmed = finalText.trim()
      if (trimmed) onTranscriptRef.current(trimmed)
    }
    recognition.onerror = (event) => {
      setListening(false)
      // "aborted" is the user/unmount cancelling; "no-speech" self-explains
      // by the session just ending — neither warrants an error surface.
      if (event.error !== "aborted" && event.error !== "no-speech") {
        onErrorRef.current?.(event.error)
      }
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }, [])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  // Abort any in-flight session on unmount so the mic is released.
  useEffect(() => () => recognitionRef.current?.abort(), [])

  return { supported: isSpeechRecognitionSupported(), listening, toggle }
}

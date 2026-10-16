import { BrowserModelAvailabilitySchema } from "@ollama-client/contracts/provider-rpc"
import type { z } from "zod"

export type Availability = z.infer<typeof BrowserModelAvailabilitySchema>
export interface PromptMessage {
  role: "system" | "user" | "assistant"
  content: string
}
export interface PromptSession extends EventTarget {
  promptStreaming(
    messages: PromptMessage[],
    options: { signal: AbortSignal }
  ): ReadableStream<string>
  destroy(): void
}
interface PromptOptions {
  expectedInputs: Array<{ type: "text" }>
  expectedOutputs: Array<{ type: "text" }>
  initialPrompts?: PromptMessage[]
  signal?: AbortSignal
  monitor?: (monitor: EventTarget) => void
}
interface PromptAPI {
  prototype?: Partial<PromptSession>
  availability(options: PromptOptions): Promise<Availability>
  create(options: PromptOptions): Promise<PromptSession>
}

/** Only the current API shape is supported; no browser/vendor sniffing or legacy flags. */
export const promptAPI = (): PromptAPI | undefined => {
  if (typeof window === "undefined") return undefined
  try {
    const api = (window as Window & { LanguageModel?: PromptAPI }).LanguageModel
    return typeof api?.availability === "function" &&
      typeof api.create === "function" &&
      typeof api.prototype?.promptStreaming === "function" &&
      typeof api.prototype.destroy === "function"
      ? api
      : undefined
  } catch {
    return undefined
  }
}

/** Identical modality options for detection, download, and inference. */
export const TEXT_OPTIONS: PromptOptions = {
  expectedInputs: [{ type: "text" }],
  expectedOutputs: [{ type: "text" }]
}

export const promptAvailability = async (): Promise<Availability> => {
  try {
    const parsed = BrowserModelAvailabilitySchema.safeParse(
      await promptAPI()?.availability(TEXT_OPTIONS)
    )
    return parsed.success ? parsed.data : "unavailable"
  } catch {
    return "unavailable"
  }
}

/** Abort promptly even if native creation settles late; destroy any abandoned session. */
export const createPromptSession = (
  options: PromptOptions
): Promise<PromptSession> => {
  const signal = options.signal
  signal?.throwIfAborted()
  const api = promptAPI()
  if (!api)
    return Promise.reject(
      new DOMException("Prompt API unavailable", "NotSupportedError")
    )
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => signal?.removeEventListener("abort", abort)
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abort = () =>
      fail(signal?.reason ?? new DOMException("Cancelled", "AbortError"))
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    try {
      // Invoke synchronously so a caller's transient activation is preserved.
      void api.create(options).then((session) => {
        if (settled || signal?.aborted) {
          try {
            session.destroy()
          } catch {
            /* Native abort may have destroyed it. */
          }
          return
        }
        settled = true
        cleanup()
        resolve(session)
      }, fail)
    } catch (error) {
      fail(error)
    }
  })
}

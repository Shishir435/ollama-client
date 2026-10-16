import { ensurePersistenceHost } from "@/lib/persistence/client"
import type { Availability } from "./api"
import { browserModelError } from "./errors"
import {
  BROWSER_MODEL_PORT,
  HostEventSchema,
  HostRequestSchema,
  type HostRequest,
  type HostEvent
} from "./protocol"

/** Background-owned stream, including abortable readiness and bounded host startup. */
export const callBrowserModelHost = async (
  request: HostRequest,
  receive: (event: HostEvent) => void,
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted()
  if (__FIREFOX_BG_OWNER__) throw browserModelError("unavailable")
  const parsedRequest = HostRequestSchema.safeParse(request)
  if (!parsedRequest.success) throw browserModelError("unsupported")
  await new Promise<void>((resolve, reject) => {
    let port: chrome.runtime.Port | undefined
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      try {
        port?.disconnect()
      } catch {
        /* A lost host is already disconnected. */
      }
      if (error !== undefined) reject(error)
      else resolve()
    }
    const abort = () =>
      finish(signal?.reason ?? new DOMException("Cancelled", "AbortError"))
    const timer = setTimeout(
      () => finish(browserModelError("timeout")),
      request.op === "status"
        ? 2_000
        : request.op === "prepare"
          ? 8_000
          : 300_000
    )
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    // Readiness is shared with persistence: stop waiting without cancelling its startup.
    void ensurePersistenceHost()
      .then(() => {
        if (settled) return
        port = chrome.runtime.connect({ name: BROWSER_MODEL_PORT })
        port.onDisconnect.addListener(() => {
          void chrome.runtime.lastError
          finish(browserModelError("disconnected"))
        })
        port.onMessage.addListener((raw: unknown) => {
          if (settled) return
          const parsed = HostEventSchema.safeParse(raw)
          if (!parsed.success) {
            finish(browserModelError("unsupported"))
            return
          }
          const event = parsed.data
          if (event.type === "error") {
            finish(browserModelError(event.code))
            return
          }
          const isStream = request.op === "stream"
          if (
            (!isStream && (event.type === "delta" || event.type === "done")) ||
            (isStream && event.type === "status") ||
            (request.op === "prepare" &&
              event.type === "status" &&
              event.availability !== "available")
          ) {
            finish(browserModelError("unsupported"))
            return
          }
          try {
            receive(event)
          } catch (error) {
            finish(error)
            return
          }
          if (event.type === "done" || event.type === "status") finish()
        })
        port.postMessage(parsedRequest.data)
      })
      .catch(() => finish(browserModelError("disconnected")))
  })
}

export const browserModelAvailability = async (
  signal?: AbortSignal
): Promise<Availability> => {
  if (__FIREFOX_BG_OWNER__) return "unavailable"
  let availability: Availability = "unavailable"
  try {
    await callBrowserModelHost(
      { op: "status" },
      (event) => {
        if (event.type === "status") availability = event.availability
      },
      signal
    )
  } catch (error) {
    if (signal?.aborted) throw error
  }
  return availability
}

/** Prove that the actual document can create a streaming session before enabling. */
export const prepareBrowserModelHost = (signal?: AbortSignal): Promise<void> =>
  callBrowserModelHost({ op: "prepare" }, () => undefined, signal)

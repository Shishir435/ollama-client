import type { BrowserModelStatusResultSchema } from "@ollama-client/contracts/provider-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import type { z } from "zod"
import { promptAPI } from "@/lib/providers/browser-built-in/api"
import { extensionRpcClient } from "@/protocol/extension-client"

type BrowserModelStatusResult = z.infer<typeof BrowserModelStatusResultSchema>

/**
 * One status read shared by the settings card and search consumers. It runs on
 * mount and when the page becomes visible; it repeats only while the model is
 * downloading, because a standing interval held the service worker awake for
 * as long as the options page was open (24 wake-ups in 120 s).
 */
const listeners = new Set<(status: BrowserModelStatusResult) => void>()
let controller: AbortController | undefined
let timer: ReturnType<typeof setInterval> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let failures = 0
/** Waits before each retry of a failed read; after the last, the next mount or visibility change tries again. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const

const syncPolling = (downloading: boolean) => {
  if (downloading && listeners.size && !timer)
    timer = setInterval(() => void refresh(), 5000)
  else if (!downloading && timer) {
    clearInterval(timer)
    timer = undefined
  }
}

const refresh = async () => {
  if (document.visibilityState === "hidden" || controller || !promptAPI())
    return
  const request = new AbortController()
  controller = request
  try {
    const status = await extensionRpcClient.call(
      RpcMethod.BrowserModelStatus,
      {},
      { signal: request.signal }
    )
    if (!request.signal.aborted) {
      failures = 0
      syncPolling(status.availability === "downloading")
      for (const listener of listeners) listener(status)
    }
  } catch {
    // Keep the last proven status across transient failures, and try again a
    // few times so one dropped worker connection does not hide a supported
    // model until the page is reopened.
    if (!request.signal.aborted && listeners.size && !retryTimer) {
      const delay = RETRY_DELAYS_MS[failures]
      failures += 1
      if (delay !== undefined)
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          void refresh()
        }, delay)
    }
  } finally {
    if (controller === request) controller = undefined
  }
}

/** A mutation invalidates any status read started before it. */
export const invalidateBrowserModelStatus = (): void => {
  controller?.abort()
  controller = undefined
}

/** Ask again now, for a caller that has just changed what the status reports. */
export const refreshBrowserModelStatus = (): void => {
  failures = 0
  void refresh()
}

const visibilityChanged = () => {
  if (document.visibilityState === "hidden") invalidateBrowserModelStatus()
  else void refresh()
}

export const observeBrowserModelStatus = (
  listener: (status: BrowserModelStatusResult) => void
): (() => void) => {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", visibilityChanged)
  }
  void refresh()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      syncPolling(false)
      clearTimeout(retryTimer)
      retryTimer = undefined
      failures = 0
      document.removeEventListener("visibilitychange", visibilityChanged)
      invalidateBrowserModelStatus()
    }
  }
}

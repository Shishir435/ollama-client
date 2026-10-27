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
      syncPolling(status.availability === "downloading")
      for (const listener of listeners) listener(status)
    }
  } catch {
    // Keep the last proven status across transient failures.
  } finally {
    if (controller === request) controller = undefined
  }
}

/** A mutation invalidates any status read started before it. */
export const invalidateBrowserModelStatus = (): void => {
  controller?.abort()
  controller = undefined
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
      document.removeEventListener("visibilitychange", visibilityChanged)
      invalidateBrowserModelStatus()
    }
  }
}

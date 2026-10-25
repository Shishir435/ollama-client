import type { BrowserModelStatusResultSchema } from "@ollama-client/contracts/provider-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import type { z } from "zod"
import { promptAPI } from "@/lib/providers/browser-built-in/api"
import { extensionRpcClient } from "@/protocol/extension-client"

type BrowserModelStatusResult = z.infer<typeof BrowserModelStatusResultSchema>

/** One visible-page poll shared by the settings card and search consumers. */
const listeners = new Set<(status: BrowserModelStatusResult) => void>()
let controller: AbortController | undefined
let timer: ReturnType<typeof setInterval> | undefined

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
    if (!request.signal.aborted)
      for (const listener of listeners) listener(status)
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
    timer = setInterval(() => void refresh(), 5000)
  }
  void refresh()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearInterval(timer)
      timer = undefined
      document.removeEventListener("visibilitychange", visibilityChanged)
      invalidateBrowserModelStatus()
    }
  }
}

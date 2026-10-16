import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useEffect, useState } from "react"
import { promptAPI } from "@/lib/providers/browser-built-in/api"
import { extensionRpcClient } from "@/protocol/extension-client"

/** Search advertises the optional control only after the host proves support. */
export const useBrowserBuiltInVisible = (): boolean => {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!promptAPI()) return
    const controller = new AbortController()
    let inFlight = false
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const status = await extensionRpcClient.call(
          RpcMethod.BrowserModelStatus,
          {},
          { signal: controller.signal }
        )
        if (controller.signal.aborted) return
        setVisible(
          Boolean(promptAPI()) &&
            (status.availability !== "unavailable" || status.enabled)
        )
      } catch {
        /* Keep the last proven state across transient host failures. */
      } finally {
        inFlight = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [])
  return visible
}

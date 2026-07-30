import { useEffect, useRef, useState } from "react"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { formatErrorForDisplay } from "@/lib/error-display"
import { logger } from "@/lib/logger"
import {
  parseModelPullServerEvent,
  STREAM_PROTOCOL_VERSION
} from "@/protocol/streams"

export const useModelPull = () => {
  const [progress, setProgress] = useState<string | null>(null)
  const [pullingModel, setPullingModel] = useState<string | null>(null)
  const portRef = useRef<browser.Runtime.Port | null>(null)

  const pullModel = (modelName: string, providerId?: string) => {
    logger.verbose("Pull model requested", "useModelPull", { modelName })
    setPullingModel(modelName)
    setProgress("Starting...")

    const port = browser.runtime.connect({
      name: MESSAGE_KEYS.PROVIDER.PULL_MODEL
    })
    portRef.current = port

    port.postMessage({
      version: STREAM_PROTOCOL_VERSION,
      type: "model_pull_start",
      payload: {
        model: modelName,
        providerId
      }
    })

    port.onMessage.addListener((msg: unknown) => {
      const parsed = parseModelPullServerEvent(msg)
      if (!parsed.success) {
        logger.warn("Dropped invalid model-pull event", "StreamProtocol", {
          issues: parsed.error.issues.length
        })
        return
      }
      const message = parsed.data
      if (message.type === "model_pull_progress") setProgress(message.status)
      if (message.type === "model_pull_complete") {
        setProgress("✅ Success")
        setPullingModel(null)
        port.disconnect()
      }
      if (message.type === "model_pull_error") {
        const errorMessage = formatErrorForDisplay(message.failure).message
        setProgress(`❌ Failed: ${errorMessage}`)
        setPullingModel(null)
        port.disconnect()
      }
    })
  }

  const cancelPull = () => {
    if (pullingModel && portRef.current) {
      portRef.current.postMessage({
        version: STREAM_PROTOCOL_VERSION,
        type: "model_pull_cancel",
        payload: { model: pullingModel }
      })
      setProgress("❌ Cancelled")
      setPullingModel(null)
      portRef.current.disconnect()
    }
  }

  useEffect(() => {
    return () => {
      portRef.current?.disconnect()
    }
  }, [])

  return { pullingModel, progress, pullModel, cancelPull }
}

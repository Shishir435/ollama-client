import { useEffect, useRef, useState } from "react"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { PullStreamMessage } from "@/types"

export const useOllamaPull = () => {
  const [progress, setProgress] = useState<string | null>(null)
  const [pullingModel, setPullingModel] = useState<string | null>(null)
  const portRef = useRef<browser.Runtime.Port | null>(null)

  const pullModel = (modelName: string) => {
    logger.verbose("Pull model requested", "useOllamaPull", { modelName })
    setPullingModel(modelName)
    setProgress("Starting...")

    const port = browser.runtime.connect({
      name: MESSAGE_KEYS.OLLAMA.PULL_MODEL
    })
    portRef.current = port

    port.postMessage({ payload: modelName })

    port.onMessage.addListener((msg: unknown) => {
      const message = msg as PullStreamMessage
      if (message.status) setProgress(message.status)
      if (message.done) {
        setProgress("✅ Success")
        setPullingModel(null)
        port.disconnect()
      }
      if (message.error) {
        const errorMessage =
          typeof message.error === "string"
            ? message.error
            : message.error.message
        setProgress(`❌ Failed: ${errorMessage}`)
        setPullingModel(null)
        port.disconnect()
      }
    })
  }

  const cancelPull = () => {
    if (pullingModel && portRef.current) {
      portRef.current.postMessage({ cancel: true, payload: pullingModel })
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

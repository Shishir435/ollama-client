import { useEffect, useRef, useState } from "react"

import { MESSAGE_KEYS } from "@/lib/constants"

export const useOllamaPull = () => {
  const [progress, setProgress] = useState<string | null>(null)
  const [pullingModel, setPullingModel] = useState<string | null>(null)
  const portRef = useRef<chrome.runtime.Port | null>(null)

  const pullModel = (modelName: string) => {
    console.log("modelName: ", modelName)
    setPullingModel(modelName)
    setProgress("Starting...")

    const port = chrome.runtime.connect({
      name: MESSAGE_KEYS.OLLAMA.PULL_MODEL
    })
    portRef.current = port

    port.postMessage({ payload: modelName })

    port.onMessage.addListener((msg) => {
      if (msg.status) setProgress(msg.status)
      if (msg.done) {
        setProgress("✅ Success")
        setPullingModel(null)
        port.disconnect()
      }
      if (msg.error) {
        setProgress("❌ Failed: " + msg.error)
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

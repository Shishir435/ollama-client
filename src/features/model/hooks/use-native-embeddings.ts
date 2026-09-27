import { RpcMethod } from "@ollama-client/contracts/rpc"
import { liveQuery } from "dexie"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSetting } from "@/hooks/use-setting"
import {
  type NativeIndexState,
  readNativeIndexState
} from "@/lib/embeddings/native/state"
import { SETTINGS } from "@/lib/storage/settings"
import { extensionRpcClient } from "@/protocol/extension-client"

/** Observe index ownership; commands and rebuilding stay in the background. */
export const useNativeEmbeddings = () => {
  const [dismissed] = useSetting(SETTINGS.BUNDLED_EMBEDDING_NOTICE_DISMISSED)
  const [state, setState] = useState<NativeIndexState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const subscription = liveQuery(readNativeIndexState).subscribe({
      next: setState,
      error: () => setError(true)
    })
    return () => {
      subscription.unsubscribe()
      controller.current?.abort()
    }
  }, [])
  const command = useCallback(
    async (
      action: "start" | "step" | "cancel" | "keep" | "dismiss" | "external"
    ) => {
      if (action === "dismiss") {
        try {
          await extensionRpcClient.call(RpcMethod.EmbeddingsNativeCommand, {
            action
          })
        } catch {
          setError(true)
        }
        return
      }
      if (action === "cancel" || action === "keep") controller.current?.abort()
      else if (controller.current) return
      const run = new AbortController()
      controller.current = run
      setBusy(true)
      setError(false)
      try {
        let status = await extensionRpcClient.call(
          RpcMethod.EmbeddingsNativeCommand,
          { action },
          { signal: run.signal }
        )
        while (
          !run.signal.aborted &&
          (action === "start" || action === "step" || action === "external") &&
          status.migration === "building"
        ) {
          status = await extensionRpcClient.call(
            RpcMethod.EmbeddingsNativeCommand,
            { action: "step" },
            { signal: run.signal }
          )
        }
      } catch {
        if (!run.signal.aborted) setError(true)
      } finally {
        if (controller.current === run) {
          controller.current = null
          setBusy(false)
        }
      }
    },
    []
  )
  return { state, dismissed, busy, error, command }
}

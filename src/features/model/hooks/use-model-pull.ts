import { useCallback, useEffect, useRef, useState } from "react"

import { formatErrorForDisplay } from "@/lib/error-display"
import { logger } from "@/lib/logger"
import { extensionRpcClient } from "@/protocol/extension-client"
import type { ModelPullJobResult } from "@/protocol/model-pull-rpc"
import { RpcMethod } from "@/protocol/rpc"

const POLL_INTERVAL_MS = 250

const isActive = (job: ModelPullJobResult): boolean =>
  job.status === "queued" || job.status === "running"

export const useModelPull = () => {
  const [progress, setProgress] = useState<string | null>(null)
  const [pullingModel, setPullingModel] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const observerRef = useRef(0)
  const mountedRef = useRef(true)

  const applyJob = useCallback((job: ModelPullJobResult) => {
    if (!mountedRef.current) return
    if (isActive(job)) {
      jobIdRef.current = job.jobId
      setPullingModel(job.model)
      setProgress(job.statusText || "Starting...")
      return
    }

    jobIdRef.current = null
    setPullingModel(null)
    if (job.status === "completed") {
      setProgress("✅ Success")
    } else if (job.status === "cancelled") {
      setProgress("❌ Cancelled")
    } else {
      const message = job.failure
        ? formatErrorForDisplay(job.failure).message
        : job.statusText || "Model download failed"
      setProgress(`❌ Failed: ${message}`)
    }
  }, [])

  const observe = useCallback(
    async (initial: ModelPullJobResult) => {
      const observer = ++observerRef.current
      let job = initial
      while (observer === observerRef.current && mountedRef.current) {
        applyJob(job)
        if (!isActive(job)) return
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
        if (observer !== observerRef.current || !mountedRef.current) return
        job = await extensionRpcClient.call(RpcMethod.ModelPullGet, {
          jobId: job.jobId
        })
      }
    },
    [applyJob]
  )

  const pullModel = useCallback(
    (modelName: string, providerId?: string) => {
      logger.verbose("Pull model requested", "useModelPull", { modelName })
      const submission = ++observerRef.current
      setPullingModel(modelName)
      setProgress("Starting...")

      void extensionRpcClient
        .call(RpcMethod.ModelPullSubmit, {
          model: modelName,
          providerId
        })
        .then((job) => {
          if (submission !== observerRef.current || !mountedRef.current) {
            return
          }
          void observe(job)
        })
        .catch((error) => {
          if (submission !== observerRef.current || !mountedRef.current) {
            return
          }
          logger.error("Model pull submission failed", "useModelPull", {
            error
          })
          setProgress(`❌ Failed: ${formatErrorForDisplay(error).message}`)
          setPullingModel(null)
        })
    },
    [observe]
  )

  const cancelPull = useCallback(() => {
    const jobId = jobIdRef.current
    observerRef.current += 1
    setProgress("❌ Cancelled")
    setPullingModel(null)
    jobIdRef.current = null
    if (!jobId) return
    void extensionRpcClient
      .call(RpcMethod.ModelPullCancel, { jobId })
      .then(applyJob)
      .catch((error) => {
        logger.error("Model pull cancellation failed", "useModelPull", {
          error
        })
      })
  }, [applyJob])

  useEffect(() => {
    mountedRef.current = true
    void extensionRpcClient
      .call(RpcMethod.ModelPullListActive, {})
      .then((jobs) => {
        const active = jobs[0]
        if (active) void observe(active)
      })
      .catch((error) => {
        logger.warn("Failed to reconnect model pull", "useModelPull", {
          error
        })
      })

    return () => {
      mountedRef.current = false
      observerRef.current += 1
    }
  }, [observe])

  return { pullingModel, progress, pullModel, cancelPull }
}

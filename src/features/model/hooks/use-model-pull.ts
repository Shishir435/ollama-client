import type { ModelPullJobResult } from "@ollama-client/contracts/model-pull-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useCallback, useEffect, useRef, useState } from "react"
import { formatErrorForDisplay } from "@/lib/error-display"
import { logger } from "@/lib/logger"
import { extensionRpcClient } from "@/protocol/extension-client"

const POLL_INTERVAL_MS = 250

const isActive = (job: ModelPullJobResult): boolean =>
  job.status === "queued" || job.status === "running"

export const useModelPull = () => {
  const [progress, setProgress] = useState<string | null>(null)
  const [pullingModel, setPullingModel] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const observerRef = useRef(0)
  const mountedRef = useRef(true)
  // Submissions cancelled before they resolved. A cancel that lands while
  // `models.submitPull` is in flight has no job id yet, so the intent is kept
  // here and honoured when the submission returns one — a later pull must not
  // swallow it, or that download keeps running unobserved.
  const submissionRef = useRef<number | null>(null)
  const cancelledSubmissionsRef = useRef(new Set<number>())

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

  /** `applyForObserver` is null for a job the UI has already moved past — the
   * download still has to be stopped, but its result must not overwrite what
   * the user is looking at now. */
  const cancelJob = useCallback(
    (jobId: string, applyForObserver: number | null) => {
      void extensionRpcClient
        .call(RpcMethod.ModelPullCancel, { jobId })
        .then((job) => {
          if (
            applyForObserver === null ||
            applyForObserver !== observerRef.current
          ) {
            return
          }
          applyJob(job)
        })
        .catch((error) => {
          logger.error("Model pull cancellation failed", "useModelPull", {
            error
          })
        })
    },
    [applyJob]
  )

  const pullModel = useCallback(
    (modelName: string, providerId?: string) => {
      logger.verbose("Pull model requested", "useModelPull", { modelName })
      const submission = ++observerRef.current
      submissionRef.current = submission
      setPullingModel(modelName)
      setProgress("Starting...")

      void extensionRpcClient
        .call(RpcMethod.ModelPullSubmit, {
          model: modelName,
          providerId
        })
        .then((job) => {
          if (submissionRef.current === submission) {
            submissionRef.current = null
          }
          // A cancel raced the submission: the job id only exists now, so stop
          // the durable download here or it keeps running behind a UI that
          // already reported it cancelled.
          if (cancelledSubmissionsRef.current.delete(submission)) {
            cancelJob(
              job.jobId,
              submission === observerRef.current ? submission : null
            )
            return
          }
          if (submission !== observerRef.current || !mountedRef.current) {
            return
          }
          void observe(job)
        })
        .catch((error) => {
          if (submissionRef.current === submission) {
            submissionRef.current = null
          }
          cancelledSubmissionsRef.current.delete(submission)
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
    [cancelJob, observe]
  )

  const cancelPull = useCallback(() => {
    const jobId = jobIdRef.current
    const observer = ++observerRef.current
    setProgress("❌ Cancelled")
    setPullingModel(null)
    jobIdRef.current = null
    if (!jobId) {
      const pending = submissionRef.current
      if (pending !== null) cancelledSubmissionsRef.current.add(pending)
      return
    }
    cancelJob(jobId, observer)
  }, [cancelJob])

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

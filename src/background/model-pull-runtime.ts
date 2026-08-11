import type {
  ModelPullJobResult,
  ModelPullSubmitRequest
} from "@ollama-client/contracts/model-pull-rpc"
import { createAbortTimeout } from "@ollama-client/runtime-core/cancellation"
import { writeCheckpoint } from "@ollama-client/runtime-core/checkpoint"
import { consumePullStream } from "@/background/handlers/handle-pull-stream"
import { PULL_CONNECT_TIMEOUT_MS } from "@/background/lib/fetch-timeout"
import { createAppError, isAbortError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderId } from "@/lib/providers/types"
import {
  findActiveModelPullRun,
  getModelPullRun,
  listActiveModelPullRuns,
  type ModelPullRun,
  saveModelPullRun
} from "@/lib/repositories/model-pull-runs"
import { toAppFailure } from "@/protocol/app-failure"
import { MODEL_PULL_EVENT_TYPES } from "@/protocol/streams"
import type { DefaultProviderPullRequest } from "@/types"

interface ActivePull {
  controller: AbortController
  promise: Promise<void>
}

const activePulls = new Map<string, ActivePull>()

const resultFromRun = (run: ModelPullRun): ModelPullJobResult => ({
  jobId: run.id,
  model: run.model,
  ...(run.providerId && { providerId: run.providerId }),
  status: run.status,
  ...(run.statusText && { statusText: run.statusText }),
  ...(run.progress !== undefined && { progress: run.progress }),
  ...(run.failure && { failure: run.failure })
})

const checkpoint = async (
  run: ModelPullRun,
  patch: Partial<ModelPullRun>,
  options: { flush?: boolean } = {}
): Promise<ModelPullRun> => {
  return writeCheckpoint(run, patch, (updated) =>
    saveModelPullRun(updated, options)
  )
}

const execute = async (
  initialRun: ModelPullRun,
  controller: AbortController
): Promise<void> => {
  let run = initialRun
  const connectTimeout = createAbortTimeout(controller, PULL_CONNECT_TIMEOUT_MS)
  try {
    run = await checkpoint(run, {
      status: "running",
      statusText: "Connecting..."
    })
    const provider = await ProviderFactory.getProviderForModel(
      run.model,
      run.providerId
    )
    if (!provider.capabilities.modelPull) {
      throw createAppError("Model download is not supported by this provider", {
        kind: "validation",
        status: 400,
        providerId: provider.id,
        model: run.model
      })
    }

    const baseUrl = resolveProviderBaseUrl(provider.config)
    const isLmStudio = provider.id === ProviderId.LM_STUDIO
    const endpoint = isLmStudio
      ? `${baseUrl.replace(/\/v1\/?$/, "")}/api/v1/models/download`
      : `${baseUrl}/api/pull`
    const requestBody: DefaultProviderPullRequest = { name: run.model }
    const body = isLmStudio
      ? JSON.stringify({ model: run.model })
      : JSON.stringify(requestBody)
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal
    })
    connectTimeout.clear()

    if (!response.ok) {
      throw createAppError(
        response.statusText || "Model download request failed",
        {
          kind: "provider",
          status: response.status,
          providerId: provider.id,
          model: run.model,
          baseUrl,
          retryable: response.status >= 500
        }
      )
    }

    if (isLmStudio) {
      await checkpoint(run, {
        status: "completed",
        statusText: "Download requested",
        progress: 100
      })
      return
    }
    if (!response.body) {
      throw createAppError("No response body received", {
        kind: "provider",
        providerId: provider.id,
        model: run.model
      })
    }

    let terminal = false
    await consumePullStream(response, {
      isCancelled: () => controller.signal.aborted,
      onEvent: async (event) => {
        if (event.type === MODEL_PULL_EVENT_TYPES.PROGRESS) {
          run = await checkpoint(
            run,
            {
              status: "running",
              statusText: event.status,
              ...(event.progress !== undefined && {
                progress: event.progress
              })
            },
            { flush: false }
          )
          return
        }
        if (event.type === MODEL_PULL_EVENT_TYPES.COMPLETE) {
          terminal = true
          run = await checkpoint(run, {
            status: "completed",
            statusText: event.status || "Success",
            progress: 100
          })
          return
        }
        terminal = true
        run = await checkpoint(run, {
          status: "failed",
          statusText: event.failure.message,
          failure: event.failure
        })
      }
    })
    controller.signal.throwIfAborted()
    if (!terminal) {
      throw createAppError("Model download stream ended before completion", {
        kind: "network",
        providerId: provider.id,
        model: run.model,
        retryable: true
      })
    }
  } catch (error) {
    connectTimeout.clear()
    if (run.status === "completed" || run.status === "failed") return
    const cancelled = isAbortError(error) && !connectTimeout.timedOut()
    const failure = cancelled
      ? undefined
      : toAppFailure(error, {
          status: connectTimeout.timedOut() ? 408 : undefined,
          fallbackMessage: connectTimeout.timedOut()
            ? `Connection timed out after ${PULL_CONNECT_TIMEOUT_MS / 1000}s`
            : "Failed to pull model",
          providerId: run.providerId
        })
    await checkpoint(run, {
      status: cancelled ? "cancelled" : "failed",
      statusText: cancelled ? "Cancelled" : failure?.message,
      failure
    })
  }
}

const start = (run: ModelPullRun): Promise<void> => {
  const active = activePulls.get(run.id)
  if (active) return active.promise
  const controller = new AbortController()
  const promise = execute(run, controller).finally(() => {
    activePulls.delete(run.id)
  })
  activePulls.set(run.id, { controller, promise })
  return promise
}

export const ModelPullService = {
  async submit(request: ModelPullSubmitRequest): Promise<ModelPullJobResult> {
    const existing = await findActiveModelPullRun(
      request.model,
      request.providerId
    )
    if (existing) {
      void start(existing)
      return resultFromRun(existing)
    }

    const now = Date.now()
    const run: ModelPullRun = {
      id: crypto.randomUUID(),
      model: request.model,
      providerId: request.providerId,
      status: "queued",
      statusText: "Starting...",
      createdAt: now,
      updatedAt: now
    }
    await saveModelPullRun(run)
    void start(run).catch((error) => {
      logger.error("Durable model pull failed", "ModelPullService", {
        jobId: run.id,
        error
      })
    })
    return resultFromRun(run)
  },

  async get(jobId: string): Promise<ModelPullJobResult> {
    const run = await getModelPullRun(jobId)
    if (!run) {
      throw createAppError("Model download job not found", {
        kind: "validation",
        status: 404
      })
    }
    return resultFromRun(run)
  },

  async listActive(): Promise<ModelPullJobResult[]> {
    const runs = await listActiveModelPullRuns()
    return runs.map(resultFromRun)
  },

  async cancel(jobId: string): Promise<ModelPullJobResult> {
    const active = activePulls.get(jobId)
    active?.controller.abort()
    await active?.promise

    const run = await getModelPullRun(jobId)
    if (!run) {
      throw createAppError("Model download job not found", {
        kind: "validation",
        status: 404
      })
    }
    if (run.status === "queued" || run.status === "running") {
      const cancelled = await checkpoint(run, {
        status: "cancelled",
        statusText: "Cancelled"
      })
      return resultFromRun(cancelled)
    }
    return resultFromRun(run)
  },

  async resumeIncomplete(): Promise<void> {
    const runs = await listActiveModelPullRuns()
    await Promise.all(runs.map(start))
  }
}

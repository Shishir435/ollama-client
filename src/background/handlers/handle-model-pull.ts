import { handlePullStream } from "@/background/handlers/handle-pull-stream"
import {
  abortAndClearController,
  clearAbortController,
  setAbortController
} from "@/background/lib/abort-controller-registry"
import { normalizeError } from "@/background/lib/error-handler"
import {
  createAbortTimeout,
  PULL_CONNECT_TIMEOUT_MS
} from "@/background/lib/fetch-timeout"
import {
  getBaseUrl,
  getPullAbortControllerKey,
  safePostMessage
} from "@/background/lib/utils"
import { isAbortError } from "@/lib/error-utils"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderId } from "@/lib/providers/types"
import type {
  ChromePort,
  DefaultProviderPullRequest,
  ModelPullMessage,
  PortStatusFunction
} from "@/types"

export const handleModelPull = async (
  msg: ModelPullMessage,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<void> => {
  const payload = msg.payload
  const modelName = typeof payload === "string" ? payload : payload.model
  const providerId =
    typeof payload === "string" ? undefined : payload.providerId

  if (msg.cancel) {
    abortAndClearController(modelName)
    return
  }

  const provider = await ProviderFactory.getProviderForModel(
    modelName,
    providerId
  )
  if (!provider.capabilities.modelPull) {
    safePostMessage(port, {
      error: {
        status: 400,
        message: "Model download is not supported by this provider"
      }
    })
    return
  }
  const baseUrl = providerId
    ? provider.config.baseUrl || (await getBaseUrl())
    : await getBaseUrl()

  const controller = new AbortController()
  const controllerKey = getPullAbortControllerKey(port.name, modelName)
  setAbortController(controllerKey, controller)

  // Cap the initial connection only — once headers arrive the download stream
  // may legitimately run for minutes, so the timer is cleared before streaming.
  const connectTimeout = createAbortTimeout(controller, PULL_CONNECT_TIMEOUT_MS)

  try {
    const requestBody: DefaultProviderPullRequest = { name: modelName }
    const isLmStudio = provider.id === ProviderId.LM_STUDIO
    const endpoint = isLmStudio
      ? `${baseUrl.replace(/\/v1\/?$/, "")}/api/v1/models/download`
      : `${baseUrl}/api/pull`
    const body = isLmStudio
      ? JSON.stringify({ model: modelName })
      : JSON.stringify(requestBody)

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal
    })
    connectTimeout.clear()

    if (!res.ok) {
      safePostMessage(port, {
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    if (isLmStudio) {
      safePostMessage(port, {
        status: "Download requested",
        done: true
      })
      return
    }

    if (!res.body) {
      safePostMessage(port, { error: "No response body received" })
      return
    }

    await handlePullStream(res, port, isPortClosed, modelName)
  } catch (err) {
    connectTimeout.clear()
    if (connectTimeout.timedOut()) {
      safePostMessage(port, {
        error: {
          status: 408,
          message: `Connection timed out after ${
            PULL_CONNECT_TIMEOUT_MS / 1000
          }s. Is the provider running and reachable?`
        }
      })
    } else if (isAbortError(err)) {
      safePostMessage(port, { error: "Download cancelled" })
    } else {
      safePostMessage(port, {
        error: normalizeError(err, { fallbackMessage: "Failed to pull model" })
      })
    }
    clearAbortController(controllerKey)
  }
}

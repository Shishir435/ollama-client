import { handlePullStream } from "@/background/handlers/handle-pull-stream"
import {
  abortAndClearController,
  clearAbortController,
  setAbortController
} from "@/background/lib/abort-controller-registry"
import {
  getBaseUrl,
  getPullAbortControllerKey,
  safePostMessage
} from "@/background/lib/utils"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderId } from "@/lib/providers/types"
import type {
  ChromePort,
  DefaultProviderPullRequest,
  ModelPullMessage,
  NetworkError,
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
  const baseUrl = providerId
    ? provider.config.baseUrl || (await getBaseUrl())
    : await getBaseUrl()

  const controller = new AbortController()
  const controllerKey = getPullAbortControllerKey(port.name, modelName)
  setAbortController(controllerKey, controller)

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
    const error = err as NetworkError
    if (error.name === "AbortError") {
      safePostMessage(port, { error: "Download cancelled" })
    } else {
      safePostMessage(port, {
        error: { status: 0, message: error.message || "Failed to pull model" }
      })
    }
    clearAbortController(controllerKey)
  }
}

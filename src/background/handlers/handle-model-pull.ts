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
import type {
  ChromePort,
  ModelPullMessage,
  NetworkError,
  OllamaPullRequest,
  PortStatusFunction
} from "@/types"

export async function handleModelPull(
  msg: ModelPullMessage,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<void> {
  const modelName = msg.payload
  if (msg.cancel) {
    abortAndClearController(modelName)
    return
  }

  const baseUrl = await getBaseUrl()

  const controller = new AbortController()
  const controllerKey = getPullAbortControllerKey(port.name, modelName)
  setAbortController(controllerKey, controller)

  try {
    const requestBody: OllamaPullRequest = {
      name: modelName
    }

    const res = await fetch(`${baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    })

    if (!res.ok) {
      safePostMessage(port, {
        error: { status: res.status, message: res.statusText }
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

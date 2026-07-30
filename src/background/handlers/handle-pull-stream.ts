import { clearAbortController } from "@/background/lib/abort-controller-registry"
import {
  getPullAbortControllerKey,
  safePostModelPullEvent
} from "@/background/lib/utils"
import { logger } from "@/lib/logger"
import { toAppFailure } from "@/protocol/app-failure"
import type {
  ChromePort,
  DefaultProviderPullResponse,
  PortStatusFunction
} from "@/types"

export const handlePullStream = async (
  res: Response,
  port: ChromePort,
  isPortClosed: PortStatusFunction,
  modelName: string
): Promise<void> => {
  logger.info("Pull stream started", "handlePullStream", { modelName })
  if (!res.body) return

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  const controllerKey = getPullAbortControllerKey(port.name, modelName)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (isPortClosed()) {
        reader.cancel().catch((err) =>
          logger.error("Failed to cancel reader", "handlePullStream", {
            error: err
          })
        )
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue

        try {
          const data: DefaultProviderPullResponse = JSON.parse(trimmedLine)

          if (data.status) {
            safePostModelPullEvent(port, {
              version: 1,
              type: "model_pull_progress",
              status: data.status
            })

            if (data.status === "success") {
              safePostModelPullEvent(port, {
                version: 1,
                type: "model_pull_complete",
                status: data.status
              })
              clearAbortController(controllerKey)
              return
            }
          }

          if (data.error) {
            safePostModelPullEvent(port, {
              version: 1,
              type: "model_pull_error",
              failure: toAppFailure(data.error)
            })
            clearAbortController(controllerKey)
            return
          }

          if (data.completed !== undefined && data.total !== undefined) {
            const progress = Math.round((data.completed / data.total) * 100)
            safePostModelPullEvent(port, {
              version: 1,
              type: "model_pull_progress",
              status: `Downloading: ${progress}%`,
              progress
            })
          }
        } catch (parseError) {
          logger.warn("Failed to parse line", "handlePullStream", {
            line: trimmedLine,
            error: parseError
          })
        }
      }
    }

    if (buffer.trim() && !isPortClosed()) {
      try {
        const data: DefaultProviderPullResponse = JSON.parse(buffer.trim())
        if (data.status === "success") {
          safePostModelPullEvent(port, {
            version: 1,
            type: "model_pull_complete",
            status: data.status
          })
        }
      } catch (parseError) {
        logger.warn("Failed to parse final buffer", "handlePullStream", {
          buffer,
          error: parseError
        })
      }
    }
  } finally {
    clearAbortController(controllerKey)
  }
}

import type { ChromePort, NetworkError, PortStatusFunction } from "../../types"
import {
  clearAbortController,
  setAbortController
} from "./abort-controller-registry"
import { safePostMessage } from "./utils"

type HandlerFunction<T> = (
  msg: T,
  port: ChromePort,
  isPortClosed: PortStatusFunction
) => Promise<void>

interface ErrorContext {
  handler: string
  operation?: string
  modelId?: string
  providerId?: string
}

/**
 * Higher-order function to wrap background message handlers with:
 * 1. Automatic AbortController lifecycle management
 * 2. Standardized error handling (AbortError vs Generic Error)
 * 3. Port closed checks
 * 4. Contextual error logging
 */
export const withErrorContext = <T>(
  handler: HandlerFunction<T>,
  context: ErrorContext
) => {
  return async (msg: T, port: ChromePort, isPortClosed: PortStatusFunction) => {
    // 1. Setup AbortController
    // We assume the handler might need one. Even if it doesn't use it,
    // setting it up ensures consistency for cancellable operations.
    const ac = new AbortController()
    setAbortController(port.name, ac)

    try {
      // 2. Execute the handler
      await handler(msg, port, isPortClosed)
    } catch (err) {
      const error = err as NetworkError

      // 3. Handle AbortError specifically
      if (error.name === "AbortError") {
        if (!isPortClosed()) {
          safePostMessage(port, { done: true, aborted: true })
        }
        return
      }

      // 4. Handle generic errors with enhanced logging
      console.error(
        `[${context.handler}] Error during ${context.operation || "operation"}:`,
        {
          message: error.message,
          model: context.modelId,
          provider: context.providerId,
          stack: error.stack
        }
      )

      if (!isPortClosed()) {
        safePostMessage(port, {
          error: {
            status: error.status ?? 500,
            message: error.message || "An unexpected error occurred",
            context: `${context.handler}${context.operation ? ` - ${context.operation}` : ""}`,
            providerId: context.providerId
          }
        })
      }
    } finally {
      // 5. Cleanup
      clearAbortController(port.name)
    }
  }
}

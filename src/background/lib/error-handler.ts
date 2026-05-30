import { logger } from "@/lib/logger"
import type { ChromePort, NetworkError, PortStatusFunction } from "@/types"
import { clearAbortController } from "./abort-controller-registry"
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
 * 1. Standardized error handling (AbortError vs Generic Error)
 * 2. Port closed checks
 * 3. Contextual error logging
 *
 * Each handler manages its own AbortController lifecycle.
 * The finally block here clears any leftover registration as a
 * safety net.
 */
export const withErrorContext = <T>(
  handler: HandlerFunction<T>,
  context: ErrorContext
) => {
  return async (msg: T, port: ChromePort, isPortClosed: PortStatusFunction) => {
    try {
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
      logger.error(
        `Error during ${context.operation || "operation"}`,
        context.handler,
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

import { logger } from "@/lib/logger"

interface ContentDebugWindow extends Window {
  __OLLAMA_CLIENT_CONTENT_DEBUG__?: boolean
}

export const isContentDebugEnabled = (): boolean =>
  Boolean(
    (window as unknown as ContentDebugWindow).__OLLAMA_CLIENT_CONTENT_DEBUG__
  )

export const contentDebugLog = (...args: unknown[]): void => {
  if (isContentDebugEnabled()) {
    const [message, ...details] = args
    logger.info(String(message ?? "Content debug event"), "ContentDebug", {
      details
    })
  }
}

export const contentDebugError = (message: string, error: unknown): void => {
  logger.error(message, "ContentDebug", { error })
}

/**
 * Log levels for the application
 * Higher values = more severe
 */
export enum LogLevel {
  DEBUG = 0,
  VERBOSE = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4
}

export const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "debug",
  [LogLevel.VERBOSE]: "verbose",
  [LogLevel.INFO]: "info",
  [LogLevel.WARN]: "warn",
  [LogLevel.ERROR]: "error"
}

export interface LogEntry {
  timestamp: number
  level: LogLevel
  context?: string
  message: string
  data?: unknown
  sessionId?: string
}

/**
 * Lightweight logger that outputs to the browser console.
 * Logs are captured natively by the browser's DevTools.
 *
 * Usage:
 * ```typescript
 * import { logger } from "@/lib/logger"
 *
 * logger.info("User logged in", "AuthComponent", { userId: 123 })
 * logger.error("Failed to fetch data", "APIHandler", { error })
 * ```
 */
export class Logger {
  private currentLevel: LogLevel

  constructor(defaultLevel = LogLevel.INFO) {
    this.currentLevel = defaultLevel
  }

  private log(
    level: LogLevel,
    message: string,
    context?: string,
    data?: unknown,
    sessionId?: string
  ) {
    if (level < this.currentLevel) {
      return
    }

    const levelName = LOG_LEVEL_NAMES[level]
    const timestamp = new Date().toISOString()
    const contextStr = context ? `[${context}]` : ""
    const sessionStr = sessionId ? `[Session:${sessionId}]` : ""
    const formatted = `${timestamp} ${levelName.toUpperCase()} ${contextStr}${sessionStr} ${message}`

    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.VERBOSE:
        console.log(formatted, data ?? "")
        break
      case LogLevel.INFO:
        console.info(formatted, data ?? "")
        break
      case LogLevel.WARN:
        console.warn(formatted, data ?? "")
        break
      case LogLevel.ERROR:
        console.error(formatted, data ?? "")
        break
    }
  }

  debug(message: string, context?: string, data?: unknown, sessionId?: string) {
    this.log(LogLevel.DEBUG, message, context, data, sessionId)
  }

  verbose(
    message: string,
    context?: string,
    data?: unknown,
    sessionId?: string
  ) {
    this.log(LogLevel.VERBOSE, message, context, data, sessionId)
  }

  info(message: string, context?: string, data?: unknown, sessionId?: string) {
    this.log(LogLevel.INFO, message, context, data, sessionId)
  }

  warn(message: string, context?: string, data?: unknown, sessionId?: string) {
    this.log(LogLevel.WARN, message, context, data, sessionId)
  }

  error(message: string, context?: string, data?: unknown, sessionId?: string) {
    this.log(LogLevel.ERROR, message, context, data, sessionId)
  }
}

export const logger = new Logger()

import { Storage as PlasmoStorage } from "@plasmohq/storage"
import Dexie, { type Table } from "dexie"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

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

/**
 * Single log entry with metadata
 */
export interface LogEntry {
  timestamp: number
  level: LogLevel
  context?: string // Component/module name (e.g., "handleGetModels", "ChatComponent")
  message: string
  data?: unknown // Additional payload (errors, objects, etc.)
  sessionId?: string // Optional session ID for filtering
}

/**
 * IndexedDB for persistent log storage
 */
class LogDatabase extends Dexie {
  logs!: Table<LogEntry & { id?: number }>

  constructor() {
    super("LogDatabase")
    this.version(1).stores({
      logs: "++id, timestamp, level"
    })
  }
}

const logDb = new LogDatabase()

/**
 * Centralized logger with configurable log levels and circular buffer
 *
 * Features:
 * - Configurable log levels (debug, verbose, info, warn, error)
 * - Circular buffer to prevent memory bloat
 * - Structured logging with timestamp, context, and metadata
 * - Export logs as JSON for debugging
 * - Persists log level preference to storage
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
  private buffer: LogEntry[] = []
  private maxBufferSize: number
  private currentLevel: LogLevel
  private enabled: boolean = true
  private useIndexedDB: boolean = true
  private storageKey = "logger-level"
  private enabledKey = "logger-enabled"
  private useIndexedDBKey = "logger-use-indexeddb"
  private bufferKey = "logger-buffer"
  private isLoadingBuffer = false

  // Use local storage for logs (larger quota than sync)
  private localStorage = new PlasmoStorage({ area: "local" })

  constructor(maxBufferSize = 1000, defaultLevel = LogLevel.INFO) {
    this.maxBufferSize = maxBufferSize
    this.currentLevel = defaultLevel
    this.loadLogLevel()
    this.loadEnabled()
    this.loadUseIndexedDB()
    this.loadBuffer()
  }

  /**
   * Load log level from storage
   */
  private async loadLogLevel() {
    try {
      const stored = await plasmoGlobalStorage.get(this.storageKey)
      if (stored && typeof stored === "number") {
        this.currentLevel = stored as LogLevel
      }
    } catch (error) {
      console.warn("Failed to load log level from storage:", error)
    }
  }

  /**
   * Save log level to storage
   */
  private async saveLogLevel() {
    try {
      await plasmoGlobalStorage.set(this.storageKey, this.currentLevel)
    } catch (error) {
      console.warn("Failed to save log level to storage:", error)
    }
  }

  /**
   * Load enabled state from storage
   */
  private async loadEnabled() {
    try {
      const stored = await plasmoGlobalStorage.get(this.enabledKey)
      if (stored !== undefined && typeof stored === "boolean") {
        this.enabled = stored
      }
    } catch (error) {
      console.warn("Failed to load logger enabled state:", error)
    }
  }

  /**
   * Save enabled state to storage
   */
  private async saveEnabled() {
    try {
      await plasmoGlobalStorage.set(this.enabledKey, this.enabled)
    } catch (error) {
      console.warn("Failed to save logger enabled state:", error)
    }
  }

  /**
   * Load useIndexedDB preference from storage
   */
  private async loadUseIndexedDB() {
    try {
      const stored = await plasmoGlobalStorage.get(this.useIndexedDBKey)
      if (stored !== undefined && typeof stored === "boolean") {
        this.useIndexedDB = stored
      }
    } catch (error) {
      console.warn("Failed to load IndexedDB preference:", error)
    }
  }

  /**
   * Save useIndexedDB preference to storage
   */
  private async saveUseIndexedDB() {
    try {
      await plasmoGlobalStorage.set(this.useIndexedDBKey, this.useIndexedDB)
    } catch (error) {
      console.warn("Failed to save IndexedDB preference:", error)
    }
  }

  /**
   * Load log buffer from storage (Chrome Storage + IndexedDB)
   */
  private async loadBuffer() {
    if (this.isLoadingBuffer) return
    this.isLoadingBuffer = true

    try {
      if (this.useIndexedDB) {
        // Load from IndexedDB (primary store)
        const logs = await logDb.logs
          .orderBy("timestamp")
          .reverse()
          .limit(this.maxBufferSize)
          .toArray()
        this.buffer = logs.reverse()
      } else {
        // Fallback to Chrome Storage (Local)
        const stored = await this.localStorage.get<LogEntry[]>(this.bufferKey)
        if (stored && Array.isArray(stored)) {
          this.buffer = stored
        }
      }
    } catch (error) {
      console.warn("Failed to load log buffer:", error)
    } finally {
      this.isLoadingBuffer = false
    }
  }

  /**
   * Save log buffer to storage (debounced)
   * Saves to both Chrome Storage (for cross-context) and IndexedDB (if enabled)
   */
  private saveBufferDebounced = (() => {
    let timeoutId: NodeJS.Timeout | null = null
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(async () => {
        try {
          // Always save to Chrome Storage (Local) for cross-context access
          await this.localStorage.set(this.bufferKey, this.buffer)

          // Also save to IndexedDB if enabled (for persistence)
          if (this.useIndexedDB) {
            // Clear old logs first
            await logDb.logs.clear()
            // Add current buffer
            await logDb.logs.bulkAdd(this.buffer)
          }
        } catch (error) {
          console.warn("Failed to save log buffer:", error)
        }
      }, 500) // Save after 500ms of inactivity
    }
  })()

  /**
   * Add log entry to buffer and console
   */
  private log(
    level: LogLevel,
    message: string,
    context?: string,
    data?: unknown,
    sessionId?: string
  ) {
    // Skip if logger is disabled
    if (!this.enabled) {
      return
    }

    // Skip if below current log level
    if (level < this.currentLevel) {
      return
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      context,
      data,
      sessionId
    }

    // Add to circular buffer
    this.buffer.push(entry)
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift() // Remove oldest entry
    }

    // Save to storage (debounced)
    this.saveBufferDebounced()

    // Also output to console for dev tools
    this.outputToConsole(entry)
  }

  /**
   * Output log entry to browser console
   */
  private outputToConsole(entry: LogEntry) {
    const levelName = LOG_LEVEL_NAMES[entry.level]
    const timestamp = new Date(entry.timestamp).toISOString()
    const contextStr = entry.context ? `[${entry.context}]` : ""
    const sessionStr = entry.sessionId ? `[Session:${entry.sessionId}]` : ""

    const message = `${timestamp} ${levelName.toUpperCase()} ${contextStr}${sessionStr} ${entry.message}`

    switch (entry.level) {
      case LogLevel.DEBUG:
      case LogLevel.VERBOSE:
        console.log(message, entry.data ?? "")
        break
      case LogLevel.INFO:
        console.info(message, entry.data ?? "")
        break
      case LogLevel.WARN:
        console.warn(message, entry.data ?? "")
        break
      case LogLevel.ERROR:
        console.error(message, entry.data ?? "")
        break
    }
  }

  /**
   * Log debug message (most verbose)
   */
  debug(message: string, context?: string, data?: unknown, sessionId?: string) {
    this.log(LogLevel.DEBUG, message, context, data, sessionId)
  }

  /**
   * Log verbose message (detailed info)
   */
  verbose(
    message: string,
    context?: string,
    data?: unknown,
    sessionId?: string
  ) {
    this.log(LogLevel.VERBOSE, message, context, data, sessionId)
  }

  /**
   * Log info message (normal operation)
   */
  info(message: string, context?: string, data?: unknown, sessionId?: string) {
    this.log(LogLevel.INFO, message, context, data, sessionId)
  }

  /**
   * Log warning message (potential issues)
   */
  warn(message: string, context?: string, data?: unknown, sessionId?: string) {
    this.log(LogLevel.WARN, message, context, data, sessionId)
  }

  /**
   * Log error message (failures)
   */
  error(message: string, context?: string, data?: unknown, sessionId?: string) {
    this.log(LogLevel.ERROR, message, context, data, sessionId)
  }

  /**
   * Get logs from buffer (loads from storage if needed)
   * @param level Optional filter by minimum level
   * @param limit Optional limit number of results
   */
  async getLogs(level?: LogLevel, limit?: number): Promise<LogEntry[]> {
    // Ensure buffer is loaded from storage
    await this.loadBuffer()

    let filtered = this.buffer

    // Filter by minimum level
    if (level !== undefined) {
      filtered = filtered.filter((entry) => entry.level >= level)
    }

    // Limit results (most recent first)
    if (limit !== undefined) {
      filtered = filtered.slice(-limit)
    }

    return filtered
  }

  /**
   * Export logs as JSON string
   */
  exportLogs(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        logLevel: LOG_LEVEL_NAMES[this.currentLevel],
        totalLogs: this.buffer.length,
        logs: this.buffer
      },
      null,
      2
    )
  }

  /**
   * Clear all logs from buffer and storage
   */
  async clearLogs() {
    this.buffer = []
    await this.localStorage.set(this.bufferKey, [])
    if (this.useIndexedDB) {
      await logDb.logs.clear()
    }
    this.info("Logs cleared", "Logger")
  }

  /**
   * Set current log level
   */
  async setLogLevel(level: LogLevel) {
    this.currentLevel = level
    await this.saveLogLevel()
    this.info(`Log level changed to ${LOG_LEVEL_NAMES[level]}`, "Logger", {
      level
    })
  }

  /**
   * Get current log level
   */
  getLogLevel(): LogLevel {
    return this.currentLevel
  }

  /**
   * Get log level name
   */
  getLogLevelName(): string {
    return LOG_LEVEL_NAMES[this.currentLevel]
  }

  /**
   * Get buffer size
   */
  getBufferSize(): number {
    return this.buffer.length
  }

  /**
   * Get max buffer size
   */
  getMaxBufferSize(): number {
    return this.maxBufferSize
  }

  /**
   * Enable logger
   */
  async enable() {
    this.enabled = true
    await this.saveEnabled()
  }

  /**
   * Disable logger
   */
  async disable() {
    this.enabled = false
    await this.saveEnabled()
  }

  /**
   * Check if logger is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Enable IndexedDB storage
   */
  async enableIndexedDB() {
    this.useIndexedDB = true
    await this.saveUseIndexedDB()
    // Migrate current buffer to IndexedDB
    if (this.buffer.length > 0) {
      await logDb.logs.clear()
      await logDb.logs.bulkAdd(this.buffer)
    }
  }

  /**
   * Disable IndexedDB storage
   */
  async disableIndexedDB() {
    this.useIndexedDB = false
    await this.saveUseIndexedDB()
    // Clear IndexedDB
    await logDb.logs.clear()
  }

  /**
   * Check if IndexedDB is enabled
   */
  isIndexedDBEnabled(): boolean {
    return this.useIndexedDB
  }
}

// Singleton instance
export const logger = new Logger()

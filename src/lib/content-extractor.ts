import { getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { matchesUserPattern } from "@/lib/url-pattern"
import type {
  ContentExtractionConfig,
  ExtractionLogEntry,
  ExtractionMetrics
} from "@/types"

/**
 * Recent extraction logs, module-local to the content-script world.
 * Previously stashed on `window.__providerExtractionLogs`; kept off the
 * window so nothing about extraction behavior is discoverable from page
 * context and the global namespace stays clean.
 */
const MAX_EXTRACTION_LOGS = 50
const extractionLogs: ExtractionLogEntry[] = []

const recordExtractionLog = (entry: ExtractionLogEntry): void => {
  extractionLogs.push(entry)
  if (extractionLogs.length > MAX_EXTRACTION_LOGS) {
    extractionLogs.shift()
  }
}

/** Read-only snapshot of recent extraction logs (debug tooling). */
export const getExtractionLogs = (): ExtractionLogEntry[] => [...extractionLogs]

/**
 * Extract domain from URL for site matching
 */
export const extractDomain = (url: string): string => {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

/**
 * Find matching site override for a URL
 */
export const findMatchingSiteOverride = (
  url: string,
  siteOverrides: Record<string, Partial<ContentExtractionConfig>>
): Partial<ContentExtractionConfig> | null => {
  const domain = extractDomain(url)

  // Exact domain match
  if (siteOverrides[domain]) {
    return siteOverrides[domain]
  }

  // Pattern matching (regex or substring, guarded against unsafe patterns)
  for (const [pattern, config] of Object.entries(siteOverrides)) {
    if (
      matchesUserPattern(url, pattern) ||
      matchesUserPattern(domain, pattern)
    ) {
      return config
    }
  }

  return null
}

/**
 * Get effective configuration for a URL
 * Priority: Site override > Global config > Defaults
 */
export const getEffectiveConfig = (
  url: string,
  globalConfig: ContentExtractionConfig,
  defaults: ContentExtractionConfig
): ContentExtractionConfig => {
  const siteOverride = findMatchingSiteOverride(url, globalConfig.siteOverrides)

  return {
    ...defaults,
    ...globalConfig,
    ...(siteOverride || {}),
    // Preserve siteOverrides from global config
    siteOverrides: globalConfig.siteOverrides
  }
}

/**
 * Detect common patterns on the page for logging/feedback
 */
export const detectPagePatterns = (): string[] => {
  const patterns: string[] = []

  // Infinite scroll detection
  const scrollContainers = document.querySelectorAll(
    '[data-scroll-container], [class*="infinite"], [class*="lazy"]'
  )
  if (scrollContainers.length > 0) {
    patterns.push("infinite-scroll")
  }

  // Lazy loading detection
  const lazyImages = document.querySelectorAll('img[loading="lazy"]')
  if (lazyImages.length > 5) {
    patterns.push("lazy-loaded-images")
  }

  // Dynamic content detection
  const reactRoot = document.querySelector('[data-reactroot], [id*="root"]')
  if (reactRoot) {
    patterns.push("react-spa")
  }

  // Modal/tabbed content
  const modals = document.querySelectorAll('[role="dialog"], [class*="modal"]')
  if (modals.length > 0) {
    patterns.push("modal-content")
  }

  // Expandable sections
  const expandables = document.querySelectorAll(
    'details, [aria-expanded], [class*="collapse"], [class*="expand"]'
  )
  if (expandables.length > 3) {
    patterns.push("expandable-content")
  }

  // Intersection Observer usage (common lazy loading pattern)
  if (window.IntersectionObserver) {
    patterns.push("intersection-observer-available")
  }

  return patterns
}

/**
 * Network instrumentation, installed once for however many extractions are
 * waiting on it.
 *
 * Each waiter used to patch `window.fetch` itself and save the value it found
 * as "the original". Two concurrent extractions therefore made the second
 * waiter adopt the first one's wrapper, and restoring out of order left a
 * wrapper installed forever — a retained closure plus dead instrumentation on
 * every later request in this content-script world. A refcount is what makes
 * install/uninstall independent of settle order.
 */
type NetworkActivityListener = () => void

const networkActivityListeners = new Set<NetworkActivityListener>()
let originalFetch: typeof window.fetch | null = null
let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null
let patchedFetch: typeof window.fetch | null = null
let patchedXhrOpen: typeof XMLHttpRequest.prototype.open | null = null

const notifyNetworkActivity = (): void => {
  for (const listener of [...networkActivityListeners]) listener()
}

const installNetworkInstrumentation = (): void => {
  if (patchedFetch) return

  const capturedFetch = window.fetch
  const capturedOpen = XMLHttpRequest.prototype.open
  originalFetch = capturedFetch
  originalXhrOpen = capturedOpen

  patchedFetch = ((...args: Parameters<typeof window.fetch>) => {
    notifyNetworkActivity()
    return capturedFetch.apply(window, args)
  }) as typeof window.fetch

  patchedXhrOpen = function (
    this: XMLHttpRequest,
    ...args: Parameters<typeof XMLHttpRequest.prototype.open>
  ) {
    notifyNetworkActivity()
    return capturedOpen.apply(this, args)
  } as typeof XMLHttpRequest.prototype.open

  window.fetch = patchedFetch
  XMLHttpRequest.prototype.open = patchedXhrOpen
}

const uninstallNetworkInstrumentation = (): void => {
  // Only restore what is still ours. If the page patched over us, putting the
  // captured value back would silently uninstall the page's own wrapper.
  if (originalFetch && window.fetch === patchedFetch) {
    window.fetch = originalFetch
  }
  if (originalXhrOpen && XMLHttpRequest.prototype.open === patchedXhrOpen) {
    XMLHttpRequest.prototype.open = originalXhrOpen
  }
  originalFetch = null
  originalXhrOpen = null
  patchedFetch = null
  patchedXhrOpen = null
}

const addNetworkActivityListener = (
  listener: NetworkActivityListener
): (() => void) => {
  networkActivityListeners.add(listener)
  if (networkActivityListeners.size === 1) installNetworkInstrumentation()

  let removed = false
  return () => {
    if (removed) return
    removed = true
    networkActivityListeners.delete(listener)
    if (networkActivityListeners.size === 0) uninstallNetworkInstrumentation()
  }
}

/**
 * Wait for network idle
 */
export const waitForNetworkIdle = (
  timeout: number,
  minIdleTime: number = 200
): Promise<void> => {
  return new Promise((resolve) => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null
    let lastActivity = Date.now()
    let settled = false
    let removeActivityListener: (() => void) | null = null

    const cleanupAndResolve = () => {
      if (settled) return
      settled = true
      if (idleTimer) clearTimeout(idleTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      removeActivityListener?.()
      resolve()
    }

    const resetIdleTimer = () => {
      if (settled) return
      if (idleTimer) clearTimeout(idleTimer)
      lastActivity = Date.now()
      idleTimer = setTimeout(() => {
        if (Date.now() - lastActivity >= minIdleTime) {
          cleanupAndResolve()
        }
      }, minIdleTime)
    }

    removeActivityListener = addNetworkActivityListener(resetIdleTimer)

    // Start idle timer
    resetIdleTimer()

    // Timeout fallback
    timeoutTimer = setTimeout(cleanupAndResolve, timeout)
  })
}

/**
 * Monitor DOM mutations
 */
export const observeDOMChanges = (
  timeout: number,
  onMutation?: (mutations: MutationRecord[]) => void
): Promise<number> => {
  return new Promise((resolve) => {
    let mutationCount = 0
    const observer = new MutationObserver((mutations) => {
      mutationCount += mutations.length
      if (onMutation) {
        onMutation(mutations)
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: true
    })

    setTimeout(() => {
      observer.disconnect()
      resolve(mutationCount)
    }, timeout)
  })
}

/**
 * Scroll strategy implementations
 */
export const scrollStrategies = {
  none: async (): Promise<number> => {
    return 0
  },

  instant: async (depth: number): Promise<number> => {
    const maxScroll =
      (document.documentElement.scrollHeight - window.innerHeight) * depth
    window.scrollTo(0, maxScroll)
    return 1
  },

  gradual: async (
    depth: number,
    delay: number,
    onProgress?: (progress: number) => void
  ): Promise<number> => {
    const maxScroll =
      (document.documentElement.scrollHeight - window.innerHeight) * depth
    const scrollStep = maxScroll / 10 // 10 steps
    let currentScroll = 0
    let steps = 0

    while (currentScroll < maxScroll) {
      currentScroll = Math.min(currentScroll + scrollStep, maxScroll)
      window.scrollTo({
        top: currentScroll,
        behavior: "smooth"
      })
      steps++

      if (onProgress) {
        onProgress(currentScroll / maxScroll)
      }

      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    return steps
  },

  smart: async (
    depth: number,
    delay: number,
    onProgress?: (progress: number) => void
  ): Promise<number> => {
    // Smart strategy: Use Intersection Observer to detect when content loads
    const maxScroll =
      (document.documentElement.scrollHeight - window.innerHeight) * depth
    const scrollStep = maxScroll / 20 // More steps for better detection
    let currentScroll = 0
    let steps = 0
    let lastContentHeight = document.documentElement.scrollHeight

    while (currentScroll < maxScroll) {
      currentScroll = Math.min(currentScroll + scrollStep, maxScroll)
      window.scrollTo({
        top: currentScroll,
        behavior: "smooth"
      })
      steps++

      if (onProgress) {
        onProgress(currentScroll / maxScroll)
      }

      // Wait a bit for lazy loading
      await new Promise((resolve) => setTimeout(resolve, delay))

      // Check if content height increased (new content loaded)
      const newContentHeight = document.documentElement.scrollHeight
      if (newContentHeight > lastContentHeight) {
        // Content loaded, wait a bit more
        await new Promise((resolve) => setTimeout(resolve, delay * 2))
        lastContentHeight = newContentHeight
      }
    }

    return steps
  }
}

/**
 * Enhanced content extraction with lazy loading support
 */
export const extractContentWithLoading = async (
  config: ContentExtractionConfig
): Promise<{
  content: string
  metrics: ExtractionMetrics
  logEntry: ExtractionLogEntry
}> => {
  const startTime = Date.now()
  const url = window.location.href
  const site = extractDomain(url)
  const detectedPatterns = detectPagePatterns()

  const metrics: ExtractionMetrics = {
    startTime,
    scrollSteps: 0,
    mutationsDetected: 0,
    contentLength: 0,
    config,
    site,
    detectedPatterns
  }

  const errors: string[] = []
  const initialScrollX = window.scrollX
  const initialScrollY = window.scrollY

  logger.info("Starting content extraction", "extractContentWithLoading", {
    site
  })
  logger.verbose("Extraction config", "extractContentWithLoading", { config })
  logger.verbose("Detected patterns", "extractContentWithLoading", {
    detectedPatterns
  })

  try {
    // Step 1: Wait for initial page load
    if (document.readyState !== "complete") {
      logger.verbose("Waiting for page load", "extractContentWithLoading")
      await new Promise((resolve) => {
        if (document.readyState === "complete") {
          resolve(undefined)
        } else {
          window.addEventListener("load", () => resolve(undefined), {
            once: true
          })
        }
      })
    }

    // Step 2: Scroll and trigger lazy loading
    if (config.scrollStrategy !== "none" && config.enabled) {
      // Always start extraction from top so we scan the full page deterministically.
      window.scrollTo(0, 0)
      await new Promise((resolve) => setTimeout(resolve, 120))

      logger.verbose("Executing scroll strategy", "extractContentWithLoading", {
        strategy: config.scrollStrategy
      })
      try {
        metrics.scrollSteps = await scrollStrategies[config.scrollStrategy](
          config.scrollDepth,
          config.scrollDelay,
          (progress) => {
            logger.verbose("Scroll progress", "extractContentWithLoading", {
              percent: (progress * 100).toFixed(0)
            })
          }
        )
      } catch (error) {
        const errorMsg = `Scroll error: ${getErrorMessage(error)}`
        errors.push(errorMsg)
        logger.error("Scroll error", "extractContentWithLoading", {
          error: errorMsg
        })
      }
    }

    // Step 3: Monitor DOM mutations
    if (config.mutationObserverTimeout > 0 && config.enabled) {
      logger.verbose("Monitoring DOM mutations", "extractContentWithLoading")
      try {
        metrics.mutationsDetected = await observeDOMChanges(
          config.mutationObserverTimeout,
          (mutations) => {
            logger.verbose("Detected mutations", "extractContentWithLoading", {
              count: mutations.length
            })
          }
        )
      } catch (error) {
        const errorMsg = `Mutation observer error: ${getErrorMessage(error)}`
        errors.push(errorMsg)
        logger.error("Mutation observer error", "extractContentWithLoading", {
          error: errorMsg
        })
      }
    }

    // Step 4: Wait for network idle
    if (config.networkIdleTimeout > 0 && config.enabled) {
      logger.verbose("Waiting for network idle", "extractContentWithLoading")
      try {
        await waitForNetworkIdle(config.networkIdleTimeout)
        logger.verbose("Network idle detected", "extractContentWithLoading")
      } catch (error) {
        const errorMsg = `Network idle error: ${getErrorMessage(error)}`
        errors.push(errorMsg)
        logger.error("Network idle error", "extractContentWithLoading", {
          error: errorMsg
        })
      }
    }

    // Step 5: Final scroll to bottom to ensure all content is loaded
    if (config.scrollStrategy !== "none" && config.enabled) {
      window.scrollTo(0, document.documentElement.scrollHeight)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    // Step 6: Clone document for Readability (will be done in index.ts)
    // Restore user's prior scroll position after extraction to avoid visual jump.
    window.scrollTo(initialScrollX, initialScrollY)

    metrics.endTime = Date.now()
    metrics.duration = metrics.endTime - metrics.startTime

    const logEntry: ExtractionLogEntry = {
      timestamp: Date.now(),
      url,
      site,
      metrics: { ...metrics },
      config,
      detectedPatterns,
      ...(errors.length > 0 && { errors })
    }

    // Log comprehensive metrics
    logger.info("Extraction completed", "extractContentWithLoading", {
      duration: `${metrics.duration}ms`
    })
    logger.verbose("Extraction metrics", "extractContentWithLoading", {
      duration: `${metrics.duration}ms`,
      scrollSteps: metrics.scrollSteps,
      mutationsDetected: metrics.mutationsDetected,
      detectedPatterns: metrics.detectedPatterns,
      site,
      config: {
        scrollStrategy: config.scrollStrategy,
        scrollDepth: `${(config.scrollDepth * 100).toFixed(0)}%`,
        scrollDelay: `${config.scrollDelay}ms`
      }
    })

    recordExtractionLog(logEntry)

    return {
      content: "", // Will be filled by Readability in index.ts
      metrics,
      logEntry
    }
  } catch (error) {
    const errorMsg = `Extraction error: ${getErrorMessage(error)}`
    errors.push(errorMsg)
    logger.error("Extraction error", "extractContentWithLoading", {
      error: errorMsg
    })

    metrics.endTime = Date.now()
    metrics.duration = metrics.endTime - metrics.startTime

    const logEntry: ExtractionLogEntry = {
      timestamp: Date.now(),
      url,
      site,
      metrics: { ...metrics },
      config,
      detectedPatterns,
      errors
    }

    recordExtractionLog(logEntry)

    throw {
      error,
      metrics,
      logEntry
    }
  }
}

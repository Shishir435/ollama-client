import type {
  ContentExtractionConfig,
  ExtractionLogEntry,
  ExtractionMetrics
} from "@/types"

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

  // Pattern matching (regex or wildcard)
  for (const [pattern, config] of Object.entries(siteOverrides)) {
    try {
      // Try regex first
      const regex = new RegExp(pattern)
      if (regex.test(url) || regex.test(domain)) {
        return config
      }
    } catch {
      // Fallback to simple string matching
      if (url.includes(pattern) || domain.includes(pattern)) {
        return config
      }
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
 * Wait for network idle
 */
export const waitForNetworkIdle = (
  timeout: number,
  minIdleTime: number = 200
): Promise<void> => {
  return new Promise((resolve) => {
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let startTime = Date.now()

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      startTime = Date.now()
      idleTimer = setTimeout(() => {
        const idleDuration = Date.now() - startTime
        if (idleDuration >= minIdleTime) {
          resolve()
        }
      }, minIdleTime)
    }

    // Monitor fetch requests
    const originalFetch = window.fetch
    window.fetch = (...args) => {
      resetIdleTimer()
      return originalFetch.apply(window, args)
    }

    // Monitor XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (...args) {
      resetIdleTimer()
      return originalOpen.apply(this, args)
    }

    // Start idle timer
    resetIdleTimer()

    // Timeout fallback
    setTimeout(() => {
      if (idleTimer) clearTimeout(idleTimer)
      resolve()
    }, timeout)
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

  console.log(`[Content Extraction] Starting extraction for ${site}`)
  console.log(`[Content Extraction] Config:`, config)
  console.log(`[Content Extraction] Detected patterns:`, detectedPatterns)

  try {
    // Step 1: Wait for initial page load
    if (document.readyState !== "complete") {
      console.log("[Content Extraction] Waiting for page load...")
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
      console.log(
        `[Content Extraction] Executing scroll strategy: ${config.scrollStrategy}`
      )
      try {
        metrics.scrollSteps = await scrollStrategies[config.scrollStrategy](
          config.scrollDepth,
          config.scrollDelay,
          (progress) => {
            console.log(
              `[Content Extraction] Scroll progress: ${(progress * 100).toFixed(0)}%`
            )
          }
        )
      } catch (error) {
        const errorMsg = `Scroll error: ${error instanceof Error ? error.message : String(error)}`
        errors.push(errorMsg)
        console.error(`[Content Extraction] ${errorMsg}`)
      }
    }

    // Step 3: Monitor DOM mutations
    if (config.mutationObserverTimeout > 0 && config.enabled) {
      console.log("[Content Extraction] Monitoring DOM mutations...")
      try {
        metrics.mutationsDetected = await observeDOMChanges(
          config.mutationObserverTimeout,
          (mutations) => {
            console.log(
              `[Content Extraction] Detected ${mutations.length} mutations`
            )
          }
        )
      } catch (error) {
        const errorMsg = `Mutation observer error: ${error instanceof Error ? error.message : String(error)}`
        errors.push(errorMsg)
        console.error(`[Content Extraction] ${errorMsg}`)
      }
    }

    // Step 4: Wait for network idle
    if (config.networkIdleTimeout > 0 && config.enabled) {
      console.log("[Content Extraction] Waiting for network idle...")
      try {
        await waitForNetworkIdle(config.networkIdleTimeout)
        console.log("[Content Extraction] Network idle detected")
      } catch (error) {
        const errorMsg = `Network idle error: ${error instanceof Error ? error.message : String(error)}`
        errors.push(errorMsg)
        console.error(`[Content Extraction] ${errorMsg}`)
      }
    }

    // Step 5: Final scroll to bottom to ensure all content is loaded
    if (config.scrollStrategy !== "none" && config.enabled) {
      window.scrollTo(0, document.documentElement.scrollHeight)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    // Step 6: Clone document for Readability (will be done in index.ts)
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
    console.log(
      `[Content Extraction] Extraction completed in ${metrics.duration}ms`
    )
    console.log(`[Content Extraction] Metrics:`, {
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

    // Store log entry for feedback (can be accessed via window.__ollamaExtractionLogs)
    if (typeof window !== "undefined") {
      const logs =
        (window as unknown as { __ollamaExtractionLogs?: ExtractionLogEntry[] })
          .__ollamaExtractionLogs || []
      logs.push(logEntry)
      // Keep only last 50 entries //page 2 make this configurable
      if (logs.length > 50) {
        logs.shift()
      }
      ;(
        window as unknown as { __ollamaExtractionLogs?: ExtractionLogEntry[] }
      ).__ollamaExtractionLogs = logs
    }

    return {
      content: "", // Will be filled by Readability in index.ts
      metrics,
      logEntry
    }
  } catch (error) {
    const errorMsg = `Extraction error: ${error instanceof Error ? error.message : String(error)}`
    errors.push(errorMsg)
    console.error(`[Content Extraction] ${errorMsg}`)

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

    throw {
      error,
      metrics,
      logEntry
    }
  }
}

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
 * Extract content from GitHub pages (fallback when Readability fails)
 * Handles both repository pages and user profile pages
 */
export const extractGitHubContent = (): string | null => {
  try {
    const url = window.location.href
    const isGitHub = url.includes("github.com")

    if (!isGitHub) return null

    const contentParts: string[] = []
    const isProfilePage =
      /github\.com\/[^/]+$/.test(url) || /github\.com\/[^/]+\/?$/.test(url)
    const isRepoPage = /github\.com\/[^/]+\/[^/]+/.test(url)

    console.log(
      `[GitHub Extraction] Page type: ${isProfilePage ? "Profile" : isRepoPage ? "Repository" : "Other"}`
    )

    // REPOSITORY PAGE EXTRACTION
    if (isRepoPage) {
      // Extract README content
      const readmeSelectors = [
        '[data-testid="readme-content"]',
        ".markdown-body",
        '[data-testid="readme-container"]',
        "article.markdown-body",
        ".repository-content .markdown-body",
        "#readme .markdown-body",
        "div[itemprop='text']"
      ]

      for (const selector of readmeSelectors) {
        const readme = document.querySelector(selector)
        if (readme) {
          const text = readme.textContent || ""
          if (text.trim().length > 50) {
            contentParts.push(`README:\n${text}`)
            break
          }
        }
      }

      // Extract repository description
      const repoDescription = document.querySelector(
        '[data-testid="repository-description"], .repository-meta-content p, p[itemprop="description"]'
      )
      if (repoDescription) {
        const desc = repoDescription.textContent?.trim()
        if (desc) {
          contentParts.push(`Description: ${desc}`)
        }
      }

      // Extract repository topics/tags
      const topics = Array.from(
        document.querySelectorAll(
          '[data-testid="topic-tag"], .topic-tag, a.topic-tag'
        )
      )
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
      if (topics.length > 0) {
        contentParts.push(`Topics: ${topics.join(", ")}`)
      }

      // Extract repository stats (stars, forks, etc.)
      const stats = Array.from(
        document.querySelectorAll(
          '[data-testid="social-count"], .Counter, a[href*="/stargazers"], a[href*="/network/members"]'
        )
      )
        .map((el) => el.textContent?.trim())
        .filter(Boolean)
        .slice(0, 4) // Limit to first 4 stats
      if (stats.length > 0) {
        contentParts.push(`Stats: ${stats.join(" | ")}`)
      }
    }

    // PROFILE PAGE EXTRACTION
    if (isProfilePage) {
      // Extract user bio
      const bioSelectors = [
        "[data-bio-text]",
        ".p-note.user-profile-bio",
        'div[itemprop="description"]',
        ".user-profile-bio",
        "div.profile-bio"
      ]

      for (const selector of bioSelectors) {
        const bio = document.querySelector(selector)
        if (bio) {
          const text = bio.textContent?.trim()
          if (text && text.length > 10) {
            contentParts.push(`Bio: ${text}`)
            break
          }
        }
      }

      // Extract pinned repositories
      const pinnedRepos = Array.from(
        document.querySelectorAll(".pinned-item-list-item, [data-pinned-item]")
      ).slice(0, 6) // Limit to 6 pinned repos

      if (pinnedRepos.length > 0) {
        const repoInfo = pinnedRepos
          .map((repo) => {
            const name = repo.querySelector('a[href*="/"]')?.textContent?.trim()
            const desc = repo
              .querySelector("p.pinned-item-desc")
              ?.textContent?.trim()
            return name ? (desc ? `${name}: ${desc}` : name) : null
          })
          .filter(Boolean)

        if (repoInfo.length > 0) {
          contentParts.push(`Pinned Repositories:\n${repoInfo.join("\n")}`)
        }
      }

      // Extract profile stats (followers, following, etc.)
      const profileStats = Array.from(
        document.querySelectorAll(
          'a[href*="/followers"], a[href*="/following"], .Counter'
        )
      )
        .map((el) => {
          const text = el.textContent?.trim()
          const label = el.getAttribute("aria-label") || el.textContent?.trim()
          return label || text
        })
        .filter(Boolean)
        .slice(0, 3)

      if (profileStats.length > 0) {
        contentParts.push(`Profile Stats: ${profileStats.join(" | ")}`)
      }

      // Extract location/company if available
      const location = document
        .querySelector('[itemprop="address"], .p-label')
        ?.textContent?.trim()
      if (location) {
        contentParts.push(`Location: ${location}`)
      }
    }

    // COMMON EXTRACTION (works for both pages)
    // Extract from main content area as fallback
    if (contentParts.length === 0) {
      const mainContent = document.querySelector(
        '[role="main"], .repository-content, main, .application-main'
      )
      if (mainContent) {
        try {
          // Remove navigation, headers, and other non-content elements
          const clone = mainContent.cloneNode(true) as HTMLElement
          const elementsToRemove = clone.querySelectorAll(
            'nav, header, [role="navigation"], .octicon, [aria-label*="navigation"], .Header, .js-header-wrapper'
          )
          elementsToRemove.forEach((el) => {
            if (el?.parentNode) {
              el.remove()
            }
          })

          // Also remove common GitHub UI elements
          const uiElements = clone.querySelectorAll(
            '.btn, .Button, [role="button"], .dropdown, .octicon, svg, .Details, summary'
          )
          uiElements.forEach((el) => {
            // Keep text but remove interactive elements
            if (!el) return // Skip null elements
            const tagName = el.tagName
            if (
              el.parentNode &&
              tagName &&
              (tagName === "SUMMARY" || tagName === "BUTTON")
            ) {
              el.remove()
            }
          })

          const text = clone.textContent || ""
          if (text.trim().length > 50) {
            contentParts.push(text)
          }
        } catch (error) {
          console.error(
            "[GitHub Extraction] Error in fallback extraction:",
            error
          )
          // Don't throw - just log and continue
        }
      }
    }

    const result = contentParts.length > 0 ? contentParts.join("\n\n") : null
    console.log(
      `[GitHub Extraction] Result: ${result ? `${result.length} chars` : "null"}`
    )
    return result
  } catch (error) {
    console.error("[GitHub Extraction] Error:", error)
    // Return null on error to allow fallback to basic extraction
    return null
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

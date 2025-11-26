import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import {
  extractDomain,
  findMatchingSiteOverride,
  getEffectiveConfig,
  detectPagePatterns,
  extractContentWithLoading,
  scrollStrategies
} from "../content-extractor"
import type { ContentExtractionConfig } from "@/types"

describe("Content Extractor", () => {
  const defaultConfig: ContentExtractionConfig = {
      enabled: true,
      scrollStrategy: "none",
      scrollDepth: 1,
      scrollDelay: 100,
      mutationObserverTimeout: 0,
      networkIdleTimeout: 0,
      siteOverrides: {},
      contentScraper: "auto",
      excludedUrlPatterns: [],
      maxWaitTime: 0
  }

  describe("extractDomain", () => {
    it("should extract domain from URL", () => {
      expect(extractDomain("https://www.example.com/page")).toBe("example.com")
      expect(extractDomain("http://sub.domain.com")).toBe("sub.domain.com")
      expect(extractDomain("invalid-url")).toBe("")
    })
  })

  describe("findMatchingSiteOverride", () => {
    const overrides = {
      "example.com": { scrollStrategy: "smart" },
      "regex.*": { scrollStrategy: "gradual" },
      "simple-match": { scrollStrategy: "instant" }
    } as any

    it("should match exact domain", () => {
      const match = findMatchingSiteOverride("https://example.com", overrides)
      expect(match).toEqual({ scrollStrategy: "smart" })
    })

    it("should match regex pattern", () => {
      const match = findMatchingSiteOverride("https://regex-test.com", overrides)
      expect(match).toEqual({ scrollStrategy: "gradual" })
    })

    it("should match simple string inclusion", () => {
      const match = findMatchingSiteOverride("https://site.com/simple-match", overrides)
      expect(match).toEqual({ scrollStrategy: "instant" })
    })

    it("should return null for no match", () => {
      const match = findMatchingSiteOverride("https://other.com", overrides)
      expect(match).toBeNull()
    })
  })

  describe("getEffectiveConfig", () => {
    it("should merge configs correctly with priority", () => {
      const globalConfig = { ...defaultConfig, scrollDelay: 500 }
      const overrides = { "example.com": { scrollDelay: 1000 } }
      globalConfig.siteOverrides = overrides as any

      const config = getEffectiveConfig(
        "https://example.com",
        globalConfig,
        defaultConfig
      )

      expect(config.scrollDelay).toBe(1000) // Override wins
      expect(config.scrollStrategy).toBe("none") // Inherited
    })
  })

  describe("detectPagePatterns", () => {
    beforeEach(() => {
      document.body.innerHTML = ""
    })

    it("should detect infinite scroll", () => {
      const div = document.createElement("div")
      div.setAttribute("data-scroll-container", "true")
      document.body.appendChild(div)

      expect(detectPagePatterns()).toContain("infinite-scroll")
    })

    it("should detect lazy loaded images", () => {
      for (let i = 0; i < 6; i++) {
        const img = document.createElement("img")
        img.setAttribute("loading", "lazy")
        document.body.appendChild(img)
      }

      expect(detectPagePatterns()).toContain("lazy-loaded-images")
    })

    it("should detect React apps", () => {
      const root = document.createElement("div")
      root.id = "root"
      document.body.appendChild(root)

      expect(detectPagePatterns()).toContain("react-spa")
    })
  })

  describe("extractContentWithLoading", () => {
    beforeEach(() => {
      vi.useFakeTimers()
      document.body.innerHTML = "<div>Content</div>"
      window.scrollTo = vi.fn()
      // Mock console to keep output clean
      vi.spyOn(console, "log").mockImplementation(() => {})
      vi.spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it("should extract content with basic config", async () => {
      const result = await extractContentWithLoading(defaultConfig)

      expect(result.metrics).toBeDefined()
      expect(result.logEntry).toBeDefined()
      expect(result.metrics.site).toBeDefined()
    })

    it("should execute scroll strategy", async () => {
      const config = { ...defaultConfig, scrollStrategy: "instant" as const }
      
      const promise = extractContentWithLoading(config)
      await vi.runAllTimersAsync()
      const result = await promise

      expect(window.scrollTo).toHaveBeenCalled()
      expect(result.metrics.scrollSteps).toBeGreaterThan(0)
    })

    it("should handle mutation observer", async () => {
      const config = { ...defaultConfig, mutationObserverTimeout: 100 }
      
      const promise = extractContentWithLoading(config)
      
      // Trigger mutation
      document.body.appendChild(document.createElement("div"))
      
      await vi.runAllTimersAsync()
      const result = await promise

      expect(result.metrics.mutationsDetected).toBeDefined()
    })

    it("should handle errors gracefully", async () => {
      // Mock scrollTo to throw
      window.scrollTo = vi.fn().mockImplementation(() => {
        throw new Error("Scroll failed")
      })

      const config = { ...defaultConfig, scrollStrategy: "instant" as const }
      
      // Should reject with structured error object
      await expect(extractContentWithLoading(config)).rejects.toHaveProperty("error")
    })
  })
})

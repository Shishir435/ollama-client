export type ScrollStrategy = "none" | "gradual" | "instant" | "smart"
export type ContentScraper = "auto" | "defuddle" | "readability"

export interface ContentExtractionConfig {
  enabled: boolean
  showSelectionButton: boolean // Whether to show the floating AI button on text selection
  selectionActionsEnabled: boolean
  selectionActionsMinChars: number
  selectionActionsEnabledIds: string[]
  contentScraper: ContentScraper // Which scraper to use: auto (try defuddle then readability), defuddle, or readability
  excludedUrlPatterns: string[] // URL patterns to exclude from extraction
  scrollStrategy: ScrollStrategy
  scrollDepth: number // 0-1 (percentage of page)
  scrollDelay: number // ms between scroll steps
  mutationObserverTimeout: number // ms to wait for DOM changes
  networkIdleTimeout: number // ms to wait for network idle
  maxWaitTime: number // total timeout in ms
  siteOverrides: Record<string, Partial<ContentExtractionConfig>>
}

export interface ExtractionMetrics {
  startTime: number
  endTime?: number
  duration?: number
  scrollSteps: number
  mutationsDetected: number
  contentLength: number
  config: ContentExtractionConfig
  site?: string
  detectedPatterns: string[]
}

export interface ExtractionLogEntry {
  timestamp: number
  url: string
  site: string
  metrics: ExtractionMetrics
  config: ContentExtractionConfig
  detectedPatterns: string[]
  errors?: string[]
}

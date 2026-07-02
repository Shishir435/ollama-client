import type browser from "webextension-polyfill"

export interface EmbeddingStatusMessage {
  status: string
  processed?: number
  total?: number
  message?: string
}

/**
 * Durable omnibox-to-chat handoff persisted in storage. Carries the query and
 * the time it was issued so the chat surface can drop stale entries (e.g. a
 * query stored when no model was ready and never consumed) instead of
 * auto-sending them on a much later side-panel open.
 */
export interface PendingOmniboxQuery {
  query: string
  at: number
}

export interface ChromeMessage {
  type: string
  payload?: unknown
  disposition?: string
  query?: string
  name?: string
  cancel?: boolean
  fromBackground?: boolean
  error?: {
    status: number
    message: string
    kind?: import("./errors").AppErrorKind
    userMessage?: string
    retryable?: boolean
    context?: string
    providerId?: string
  }
}

// Omit the members we deliberately narrow: the base `postMessage`/`onMessage`
// are typed with `unknown`/`any` payloads, so re-declaring them with our
// message union would otherwise be an incompatible override (TS2430).
export interface ChromePort
  extends Omit<browser.Runtime.Port, "postMessage" | "onMessage"> {
  postMessage(message: ChromeMessage | EmbeddingStatusMessage): void
  onMessage: browser.Events.Event<
    (message: ChromeMessage | EmbeddingStatusMessage) => void
  >
  onDisconnect: browser.Events.Event<() => void>
  /**
   * Unique per-connection abort key, assigned by the port router. Port names
   * are shared constants, so two live ports with the same name (e.g. two
   * windows running selection actions) would collide in the abort registry
   * if keyed by name alone.
   */
  abortScopeKey?: string
}

export interface ChromeSidePanel {
  open: (options: { windowId: number; tabId?: number }) => Promise<void>
  setPanelBehavior: (options: {
    openPanelOnActionClick: boolean
  }) => Promise<void>
}

export interface ChromeResponse {
  success: boolean
  data?: unknown
  error?: {
    status: number
    message: string
    kind?: import("./errors").AppErrorKind
    userMessage?: string
    retryable?: boolean
    context?: string
    providerId?: string
  }
  tabs?: browser.Tabs.Tab[]
  html?: string
  title?: string
  extractionDebug?: {
    url: string
    title: string
    scraper: string
    profile?: "docs" | "blog" | "news" | "forum" | "video" | "general"
    hasTranscript: boolean
    transcriptLength: number
    contentLength: number
    contentHash?: string
    revisionId?: string
    capturedAt?: number
    reliabilityScore?: number
    reliabilitySignals?: {
      contentDensity: number
      boilerplateRatio: number
      noiseRatio: number
    }
    extractionDurationMs?: number
    scrollSteps?: number
    mutationsDetected?: number
    detectedPatterns?: string[]
    selectedExtractor?: "defuddle" | "readability" | "basic"
    selectedReason?: string
    filteredSectionCount?: number
    keptSectionCount?: number
    effectiveContextLength?: number
    preview?: string
  }
}

export type SendResponseFunction = (response: ChromeResponse) => void
export type PortStatusFunction = () => boolean

export interface AbortControllerMap {
  [modelName: string]: AbortController
}

export interface DNRRule {
  id: number
  priority: number
  action: {
    type: chrome.declarativeNetRequest.RuleActionType
    requestHeaders: Array<{
      header: string
      operation: chrome.declarativeNetRequest.HeaderOperation
      value: string
    }>
  }
  condition: {
    urlFilter: string
    resourceTypes: chrome.declarativeNetRequest.ResourceType[]
  }
}

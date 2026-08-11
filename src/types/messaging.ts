import type { AppFailure } from "@ollama-client/contracts/app-failure"
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
  version?: number
  payload?: unknown
  disposition?: string
  query?: string
  name?: string
  cancel?: boolean
  fromBackground?: boolean
  error?: AppFailure
  failure?: AppFailure
}

/**
 * What a stream producer needs from its destination, and nothing else.
 *
 * The chat handler writes events, reads and advances a sequence counter, and
 * names an abort scope. It never connects, disconnects, or listens — so a
 * background-owned consumer of the same stream (the durable turn runtime, which
 * reduces events instead of shipping them to a panel) can satisfy this while
 * being nothing like a real port. It used to satisfy `ChromePort` by cast
 * instead, which asserted `onMessage`, `onDisconnect`, `sender` and
 * `disconnect()` that did not exist; any handler that reached for one would
 * have failed at runtime with the type system claiming otherwise.
 *
 * `ChromePort` satisfies this structurally, so a real port is still accepted
 * everywhere this is asked for.
 */
export interface ChatStreamSink {
  name: string
  postMessage(message: ChromeMessage | EmbeddingStatusMessage): void
  /** @see ChromePort.abortScopeKey */
  abortScopeKey?: string
  /** @see ChromePort.streamSequence */
  streamSequence?: number
}

/**
 * Browser runtime port narrowed to application message unions. The base port's
 * `postMessage` and `onMessage` members are omitted first because overriding
 * their `unknown`/`any` payloads directly is incompatible under TS2430.
 */
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
  /** Next monotonic event sequence for the active chat stream. */
  streamSequence?: number
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
  error?: AppFailure
  tabs?: browser.Tabs.Tab[]
  html?: string
  title?: string
  /** Provider a model-scoped handler actually resolved the model to. */
  providerId?: string
  /** Whether that resolved provider can self-report model details. */
  supportsDetails?: boolean
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

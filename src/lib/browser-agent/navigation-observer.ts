export interface AgentNavigationDetails {
  tabId: number
  frameId: number
  url: string
  documentId?: string
}

export interface AgentNavigationEvent {
  addListener(listener: (details: AgentNavigationDetails) => void): void
  removeListener(listener: (details: AgentNavigationDetails) => void): void
}

export interface AgentNavigationSnapshot {
  tabId: number
  documentId: string
  url: string
  generation: number
}

export interface AgentNavigationObserver {
  current(tabId: number): AgentNavigationSnapshot | undefined
  stop(): void
}

export const createAgentNavigationObserver = (input: {
  committed: AgentNavigationEvent
  historyUpdated: AgentNavigationEvent
  onInvalidate?: (snapshot: AgentNavigationSnapshot) => void
}): AgentNavigationObserver => {
  const snapshots = new Map<number, AgentNavigationSnapshot>()

  const update = (details: AgentNavigationDetails) => {
    if (details.frameId !== 0 || !details.documentId) return
    const previous = snapshots.get(details.tabId)
    const snapshot = {
      tabId: details.tabId,
      documentId: details.documentId,
      url: details.url,
      generation: (previous?.generation ?? 0) + 1
    }
    snapshots.set(details.tabId, snapshot)
    input.onInvalidate?.(snapshot)
  }

  input.committed.addListener(update)
  input.historyUpdated.addListener(update)
  return {
    current: (tabId) => snapshots.get(tabId),
    stop() {
      input.committed.removeListener(update)
      input.historyUpdated.removeListener(update)
      snapshots.clear()
    }
  }
}

/** Bind the pure observer to Chromium after `webNavigation` is granted. */
export const startBrowserAgentNavigationObserver = (
  onInvalidate?: (snapshot: AgentNavigationSnapshot) => void
): AgentNavigationObserver =>
  createAgentNavigationObserver({
    committed: chrome.webNavigation
      .onCommitted as unknown as AgentNavigationEvent,
    historyUpdated: chrome.webNavigation
      .onHistoryStateUpdated as unknown as AgentNavigationEvent,
    onInvalidate
  })

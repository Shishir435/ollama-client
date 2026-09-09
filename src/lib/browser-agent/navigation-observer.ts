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

export interface AgentNavigationFrame {
  frameId: number
  documentId: string
  url: string
}

export interface AgentNavigationSnapshot {
  tabId: number
  /** The frame whose commit produced this snapshot; the root frame is 0. */
  frameId: number
  documentId: string
  url: string
  /**
   * Bumped by a commit in any frame. A child frame's references are bound to
   * its own document, so its navigation invalidates them as surely as a root
   * navigation invalidates everything.
   */
  generation: number
  /** Every frame of the tab whose document is currently known. */
  frames: readonly AgentNavigationFrame[]
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
    if (!details.documentId) return
    const previous = snapshots.get(details.tabId)
    const frame: AgentNavigationFrame = {
      frameId: details.frameId,
      documentId: details.documentId,
      url: details.url
    }
    /*
     * A root commit replaces the whole tree: every child document died with
     * the one that embedded it. A child commit replaces that child alone.
     */
    const frames =
      details.frameId === 0
        ? [frame]
        : [
            ...(previous?.frames ?? []).filter(
              (known) => known.frameId !== details.frameId
            ),
            frame
          ]
    const root = frames.find((known) => known.frameId === 0)
    const snapshot: AgentNavigationSnapshot = {
      tabId: details.tabId,
      frameId: details.frameId,
      documentId: details.documentId,
      url: details.url,
      generation: (previous?.generation ?? 0) + 1,
      frames: root ? frames : [frame, ...frames.filter((f) => f !== frame)]
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

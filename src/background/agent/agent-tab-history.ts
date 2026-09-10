/**
 * Per-tab record of committed main-frame URLs for the tabs a run controls.
 *
 * No extension API reports what a tab's back entry holds, so back/forward can
 * only be planned against navigation the run itself watched commit. An
 * unrecorded direction resolves to `undefined`, which the resolver and executor
 * both treat as "no known destination" and refuse — history the run never saw
 * is not evidence it may act on.
 */
export interface AgentTabHistory {
  /** Record a committed main-frame URL, inferring back/forward movement. */
  record(tabId: number, url: string): void
  resolveDestination(
    tabId: number,
    direction: "back" | "forward"
  ): string | undefined
  forget(tabId: number): void
}

interface TabEntries {
  urls: string[]
  index: number
}

const MAX_ENTRIES = 50

const sameUrl = (left: string | undefined, right: string): boolean => {
  if (!left) return false
  try {
    return new URL(left).href === new URL(right).href
  } catch {
    return false
  }
}

/**
 * The tab's back stack as the browser holds it, entry for entry.
 *
 * Every committed URL is recorded, including the `about:blank` a tab commits
 * before its first real page. Filtering those out is tempting and wrong: the
 * stack is walked by index, so dropping an entry would leave the run
 * predicting one destination while the browser went to another — an
 * unapproved page reached through an approval given for a different one.
 * Whether a destination may be *used* is the resolver's question, not this
 * one's.
 */
export const createAgentTabHistory = (): AgentTabHistory => {
  const tabs = new Map<number, TabEntries>()

  return {
    record(tabId, url) {
      const entries = tabs.get(tabId)
      if (!entries) {
        tabs.set(tabId, { urls: [url], index: 0 })
        return
      }
      if (sameUrl(entries.urls[entries.index], url)) return
      if (sameUrl(entries.urls[entries.index - 1], url)) {
        entries.index -= 1
        return
      }
      if (sameUrl(entries.urls[entries.index + 1], url)) {
        entries.index += 1
        return
      }
      entries.urls = [...entries.urls.slice(0, entries.index + 1), url]
      if (entries.urls.length > MAX_ENTRIES) {
        entries.urls = entries.urls.slice(entries.urls.length - MAX_ENTRIES)
      }
      entries.index = entries.urls.length - 1
    },
    resolveDestination(tabId, direction) {
      const entries = tabs.get(tabId)
      if (!entries) return undefined
      return entries.urls[
        direction === "back" ? entries.index - 1 : entries.index + 1
      ]
    },
    forget(tabId) {
      tabs.delete(tabId)
    }
  }
}

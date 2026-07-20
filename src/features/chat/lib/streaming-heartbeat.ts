import { browser } from "@/lib/browser-api"

/**
 * Cross-panel liveness signal for an in-flight chat stream. A streaming panel
 * refreshes this timestamp in shared extension storage; a freshly-mounted panel
 * reads it before the interrupted-turn sweep so it does not mark a turn that is
 * actively streaming in ANOTHER window as orphaned.
 *
 * storage.local is shared across all extension pages and survives a crash, so a
 * stale value is possible — hence freshness is judged by timestamp age, and a
 * clean unload clears the key outright (so a reload recovers immediately).
 */
const KEY = "ollama-client:streaming-heartbeat"

/** A heartbeat older than this is treated as no longer streaming. */
export const STREAMING_HEARTBEAT_STALE_MS = 12_000

export const beatStreamingHeartbeat = async (): Promise<void> => {
  try {
    await browser.storage.local.set({ [KEY]: Date.now() })
  } catch {
    // Best-effort liveness signal; a failure only costs the multi-window guard.
  }
}

export const clearStreamingHeartbeat = async (): Promise<void> => {
  try {
    await browser.storage.local.remove(KEY)
  } catch {
    // Ignore — a stale value ages out on its own.
  }
}

/**
 * True when some panel refreshed the heartbeat within the staleness window,
 * i.e. a stream is (very likely) still running somewhere. The interrupted-turn
 * sweep defers when this is true.
 */
export const isStreamingActiveElsewhere = async (
  staleMs = STREAMING_HEARTBEAT_STALE_MS
): Promise<boolean> => {
  try {
    const stored = await browser.storage.local.get(KEY)
    const ts = (stored as Record<string, unknown>)[KEY]
    return typeof ts === "number" && Date.now() - ts < staleMs
  } catch {
    return false
  }
}

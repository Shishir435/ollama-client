import type { ChatMessage } from "@/types"

/** Reply length, in characters, that adds one more base interval to the wait. */
const GROWTH_CHARS = 50_000
/** The wait never exceeds this many base intervals. */
const MAX_INTERVALS = 4

/**
 * Keep one pending snapshot and one write in flight. Observers still receive
 * every token; SQLite checkpoints at most once per interval and always drains
 * the latest snapshot before the turn settles, including provider failures.
 *
 * Every checkpoint rewrites the whole message, so a reply that keeps growing
 * writes quadratically many bytes (a 20 KB answer wrote 4 MB). The wait grows
 * with the reply, up to four intervals, which bounds that cost without
 * changing what a short answer does; a crash loses at most that wait of text.
 */
export const makeAssistantWriter = (
  write: (message: ChatMessage) => Promise<unknown>,
  intervalMs = 250
) => {
  let pending: ChatMessage | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let failure: unknown

  const delayFor = (message: ChatMessage): number =>
    intervalMs *
    Math.min(
      MAX_INTERVALS,
      1 +
        Math.floor(
          ((message.content?.length ?? 0) + (message.thinking?.length ?? 0)) /
            GROWTH_CHARS
        )
    )

  const drain = (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (inFlight) return inFlight
    if (!pending || failure) return Promise.resolve()
    const message = pending
    pending = undefined
    inFlight = (async () => {
      try {
        await write(message)
      } catch (error) {
        failure = error
      } finally {
        inFlight = undefined
        if (pending && !failure && !timer)
          timer = setTimeout(() => void drain(), delayFor(pending))
      }
    })()
    return inFlight
  }

  return {
    schedule(message: ChatMessage) {
      pending = message
      if (!timer) timer = setTimeout(() => void drain(), delayFor(message))
    },
    async flush() {
      await drain()
      // A slow write can have received another snapshot while it was pending.
      if (pending && !failure) await drain()
      clearTimeout(timer)
      timer = undefined
      if (failure) throw failure
    }
  }
}

import type { ChatMessage } from "@/types"

/**
 * Keep one pending snapshot and one write in flight. Observers still receive
 * every token; SQLite checkpoints at most once per interval and always drains
 * the latest snapshot before the turn settles, including provider failures.
 */
export const makeAssistantWriter = (
  write: (message: ChatMessage) => Promise<unknown>,
  intervalMs = 250
) => {
  let pending: ChatMessage | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let failure: unknown

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
          timer = setTimeout(() => void drain(), intervalMs)
      }
    })()
    return inFlight
  }

  return {
    schedule(message: ChatMessage) {
      pending = message
      if (!timer) timer = setTimeout(() => void drain(), intervalMs)
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

import Dexie from "dexie"

const CHANNEL_NAME = "ollama-client-vectors-changed"

let channel: BroadcastChannel | null | undefined

const vectorChannel = (): BroadcastChannel | null => {
  if (channel === undefined)
    channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(CHANNEL_NAME)
  return channel
}

const post = (): void => {
  try {
    vectorChannel()?.postMessage("changed")
  } catch {
    /** A closed channel during teardown has no reader left to tell. */
  }
}

const announced = new WeakSet<object>()

/**
 * Tell every other extension context that stored vectors changed.
 *
 * The keyword index lives in memory in each context that searches, and the
 * background now writes the vectors a side panel searches: without this the
 * panel kept the index it built on its first search and missed every exact
 * word in chats indexed after it. Each search context still builds its own
 * index; this only tells it that what it holds is stale.
 *
 * Called beside the storage-stats write that every vector mutation already
 * makes. Inside a transaction the message waits for the commit, so a reader
 * that rebuilds at once reads the new rows rather than the old ones; a
 * transaction that aborts announces nothing. A `BroadcastChannel` never
 * delivers to the object that posted, so the writing context — whose index
 * was already updated in place — is not told to throw it away.
 */
export const announceVectorChange = (): void => {
  const transaction = Dexie.currentTransaction
  if (!transaction) {
    post()
    return
  }
  if (announced.has(transaction)) return
  announced.add(transaction)
  transaction.on("complete", post)
}

/**
 * Run `listener` when another context changes stored vectors. Changes made
 * in this context are not reported: they updated its index directly.
 */
export const onVectorChangeElsewhere = (listener: () => void): (() => void) => {
  const current = vectorChannel()
  if (!current) return () => undefined
  const handler = () => listener()
  current.addEventListener("message", handler)
  return () => current.removeEventListener("message", handler)
}

export const VECTOR_CHANGE_CHANNEL_NAME = CHANNEL_NAME

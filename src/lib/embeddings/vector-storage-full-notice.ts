import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

/**
 * What the marker held the last time this context looked: the limit it
 * refused at, `null` for no marker, `undefined` for not yet read. Remembering
 * it keeps a burst of refused chunks to one write and a healthy store to none.
 */
let recorded: number | null | undefined

/**
 * Another context (the options page or a benchmark page also index) can set
 * or clear the marker, so the remembered value is dropped whenever it changes
 * and the next call reads it again. Registered at module load, as the
 * background worker requires of every listener.
 */
try {
  chrome.storage?.onChanged?.addListener((changes) => {
    if (STORAGE_KEYS.EMBEDDINGS.STORAGE_FULL in changes) recorded = undefined
  })
} catch {
  // No extension runtime (unit tests, tooling): nothing else writes the marker.
}

/**
 * Calls run one after another. A refusal and a write that fits can overlap
 * (file ingestion beside chat indexing), and each decides from what the
 * marker holds when its turn comes, not from what it held when it was asked.
 */
let queue: Promise<void> = Promise.resolve()

const apply = async (limitMB: number | null): Promise<void> => {
  try {
    const current =
      recorded !== undefined
        ? recorded
        : ((await readSetting(SETTINGS.VECTOR_STORAGE_FULL))?.limitMB ?? null)
    recorded = current
    if (current === limitMB) return
    await writeSetting(
      SETTINGS.VECTOR_STORAGE_FULL,
      limitMB === null ? null : { limitMB, at: Date.now() }
    )
    recorded = limitMB
  } catch (error) {
    // Telling the user is best effort; the refusal itself already happened.
    recorded = undefined
    logger.warn("Could not record vector storage state", "vectorStorage", {
      error
    })
  }
}

const record = (limitMB: number | null): Promise<void> => {
  const run = queue.then(() => apply(limitMB))
  queue = run
  return run
}

/** The side panel shows its notice from this, so chat indexing is not silent. */
export const noteVectorStorageFull = (limitMB: number): Promise<void> =>
  record(limitMB)

/** A new vector fit: whatever filled the store was removed or the limit raised. */
export const noteVectorStorageHasRoom = (): Promise<void> => record(null)

/** Test seam: forget what was last recorded. */
export const resetVectorStorageNoticeMemory = (): void => {
  recorded = undefined
  queue = Promise.resolve()
}

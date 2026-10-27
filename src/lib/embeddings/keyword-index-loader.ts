import { vectorDb } from "./db"
import { keywordIndexManager } from "./keyword-index"
import type { VectorDocument } from "./types"

/** Rows read per step; each carries two float arrays the index discards. */
const KEYWORD_BUILD_BATCH_SIZE = 500

/**
 * Reads the next page of stored rows in primary-key order.
 *
 * Paging by id keeps a build to one batch of full rows at a time, where
 * `toArray()` held the whole corpus — vectors included — beside the index it
 * was building.
 */
const readVectorBatch = (
  afterId: number | undefined
): Promise<VectorDocument[]> =>
  (afterId === undefined
    ? vectorDb.vectors.toCollection()
    : vectorDb.vectors.where(":id").above(afterId)
  )
    .limit(KEYWORD_BUILD_BATCH_SIZE)
    .toArray()

let load: Promise<void> | undefined

/**
 * Builds the in-memory keyword index from IndexedDB, replacing what it held.
 *
 * The index lives only in the context that built it, so a service worker that
 * restarts starts with none. `searchHybrid` runs in that worker, which is why
 * it loads through `ensureKeywordIndexLoaded` rather than relying on the side
 * panel having built a copy in its own page.
 */
export const rebuildKeywordIndex = (
  onProgress?: (processed: number) => void
): Promise<void> => {
  const current = keywordIndexManager
    .buildFromBatches(readVectorBatch, onProgress)
    .catch((error) => {
      if (load === current) load = undefined
      throw error
    })
  load = current
  return current
}

/** Loads the index once per context; concurrent callers share one build. */
export const ensureKeywordIndexLoaded = (): Promise<void> =>
  load ?? rebuildKeywordIndex()

/** Forgets the loaded index so the next `ensureKeywordIndexLoaded` rebuilds. */
export const invalidateKeywordIndex = (): void => {
  load = undefined
  keywordIndexManager.clear()
}

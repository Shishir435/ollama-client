import { logger } from "@/lib/logger"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

/**
 * What the store last told storage: the limit it refused at, `null` once a write
 * fit again, `undefined` before it has said anything this session. Remembering
 * it keeps a burst of refused chunks to one write instead of one per chunk, and
 * a healthy store to no writes at all.
 */
let recorded: number | null | undefined

const record = async (limitMB: number | null): Promise<void> => {
  if (recorded === limitMB) return
  try {
    if (limitMB === null) {
      if (
        recorded === undefined &&
        !(await readSetting(SETTINGS.VECTOR_STORAGE_FULL))
      )
        return void (recorded = null)
      await writeSetting(SETTINGS.VECTOR_STORAGE_FULL, null)
    } else {
      await writeSetting(SETTINGS.VECTOR_STORAGE_FULL, {
        limitMB,
        at: Date.now()
      })
    }
    recorded = limitMB
  } catch (error) {
    // Telling the user is best effort; the refusal itself already happened.
    logger.warn("Could not record vector storage state", "vectorStorage", {
      error
    })
  }
}

/** The side panel shows its notice from this, so chat indexing is not silent. */
export const noteVectorStorageFull = (limitMB: number): Promise<void> =>
  record(limitMB)

/** A write fit again: whatever filled the store was removed or the limit raised. */
export const noteVectorStorageHasRoom = (): Promise<void> => record(null)

/** Test seam: forget what was last recorded. */
export const resetVectorStorageNoticeMemory = (): void => {
  recorded = undefined
}

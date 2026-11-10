import { withStorageWriteLock } from "./storage-write-lock"

/** Keep live preference imports outside a backup's database/settings replacement. */
export const withModelPreferenceImportLock = <T>(
  operation: () => Promise<T>
): Promise<T> =>
  withStorageWriteLock("ollama-client:model-preference-import", operation)

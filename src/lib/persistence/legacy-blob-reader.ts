import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"

/**
 * Migration-time reader for the legacy IndexedDB blob. Loaded lazily so it
 * stays out of every startup chunk once a profile has migrated.
 *
 * This module holds no SQLite engine. The blob is a valid SQLite file, so the
 * database owner's worker surveys it through the `surveyDb` op on official
 * sqlite-wasm — the same engine that performs the import. Reading it here with
 * a second engine is what kept sql.js in the package for a read.
 */

/**
 * Normalize whatever the structured clone handed back.
 *
 * Not `instanceof Uint8Array`: that is a per-realm test, and a clone can carry
 * a view constructed elsewhere. It reads as "no blob" — which on this path
 * means "fresh profile, nothing to migrate", the one wrong answer that loses
 * history. `ArrayBuffer.isView` checks an internal slot instead, and rewrapping
 * produces a view this realm's WASM glue will also accept.
 */
const asBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return null
}

export const readLegacyBlobBytes = async (): Promise<Uint8Array | null> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result
      if (!database.objectStoreNames.contains(SQLITE_DB_STORE)) {
        database.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onsuccess = () => {
      const database = request.result
      try {
        const get = database
          .transaction([SQLITE_DB_STORE], "readonly")
          .objectStore(SQLITE_DB_STORE)
          .get(SQLITE_DB_KEY)
        get.onsuccess = () => {
          database.close()
          resolve(asBytes(get.result))
        }
        get.onerror = () => {
          database.close()
          reject(get.error)
        }
      } catch (error) {
        database.close()
        reject(error)
      }
    }
  })

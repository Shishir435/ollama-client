/**
 * Raised when storing a vector would take the store past its size limit.
 *
 * The store never makes room by deleting: a user's oldest documents are theirs,
 * and losing them silently turned "I uploaded this" into "it was never
 * searchable". Indexing stops instead, and the message is a stable code so each
 * layer between the store and the screen can recognise it without parsing
 * prose, and the screen can say it in the user's language.
 */
export const VECTOR_STORAGE_FULL = "vector_storage_full"

export class VectorStorageFullError extends Error {
  readonly maxMegabytes: number

  constructor(maxMegabytes: number) {
    super(`${VECTOR_STORAGE_FULL}:${maxMegabytes}`)
    this.name = "VectorStorageFullError"
    this.maxMegabytes = maxMegabytes
  }
}

/** The limit a failure message names, or undefined if it is not this failure. */
export const vectorStorageFullLimit = (message: string): number | undefined => {
  const match = new RegExp(
    `(?:^|\\b)${VECTOR_STORAGE_FULL}:(\\d+(?:\\.\\d+)?)`
  ).exec(message)
  return match ? Number(match[1]) : undefined
}

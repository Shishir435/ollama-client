/** Stay below practical engine string limits, including base64 and JSON overhead. */
export const MAX_PAYLOAD_CHARS = 256 * 1024 * 1024

/**
 * Largest database that can travel inside a JSON message as base64. Only the
 * paths that still do that (an encoded BLOB value, the owner-internal survey)
 * are held to it.
 */
export const MAX_INLINE_DATABASE_BYTES = (MAX_PAYLOAD_CHARS / 4) * 3 - 1024

/**
 * Largest database the owner will import or export.
 *
 * A database travels as raw frames after its request, never as one string, so
 * the string limit above no longer applies to it: the old cap of 192 MB stopped
 * both backup export and the migration of a larger legacy blob. What bounds it
 * now is memory — the sender, the receiver and the engine each hold the bytes
 * once, so this stays well below what a 64-bit renderer can allocate.
 */
export const MAX_DATABASE_BYTES = 1024 * 1024 * 1024

/** Content-free signal shared by the codec, channel, and RPC adapters. */
export class PersistencePayloadTooLargeError extends Error {
  constructor() {
    super("Persistence payload exceeds the supported transfer size")
    this.name = "PersistencePayloadTooLargeError"
  }
}

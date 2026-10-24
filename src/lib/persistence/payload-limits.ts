/** Stay below practical engine string limits, including base64 and JSON overhead. */
export const MAX_PAYLOAD_CHARS = 256 * 1024 * 1024
export const MAX_DATABASE_BYTES = (MAX_PAYLOAD_CHARS / 4) * 3 - 1024

/** Content-free signal shared by the codec, channel, and RPC adapters. */
export class PersistencePayloadTooLargeError extends Error {
  constructor() {
    super("Persistence payload exceeds the supported transfer size")
    this.name = "PersistencePayloadTooLargeError"
  }
}

import { z } from "zod"

/**
 * File and image attachments as they are persisted.
 *
 * Both carry bytes, and both accept more shapes than the runtime produces,
 * because a stringified `Uint8Array` survives an export/import round trip as an
 * index-keyed object. Application adapters normalize the accepted forms back to
 * `Uint8Array` after parsing; the schema's job is to let a valid backup load.
 */

/**
 * Persisted/imported RAG attachment contract.
 *
 * Attachment bytes accept the runtime `Uint8Array`, JSON arrays, and the
 * index-keyed object produced when a typed array is stringified. Application
 * adapters normalize all accepted forms back to `Uint8Array` after parsing.
 */
export const FileAttachmentSchema = z.object({
  id: z.number().optional(),
  fileId: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  textPreview: z.string().optional(),
  processedAt: z.number(),
  sessionId: z.string().optional(),
  messageId: z.number().optional(),
  /** Compatibility byte shapes; normalize before application use. */
  data: z
    .union([
      z.instanceof(Uint8Array),
      z.array(z.number()),
      z.record(z.string(), z.number())
    ])
    .optional()
})

/** Persisted attachment shape; `data` is not yet runtime-normalized. */
export type FileAttachmentParsed = z.infer<typeof FileAttachmentSchema>

/** Image bytes as base64, persisted through the shared `files` table. */
export const ImageAttachmentSchema = z.object({
  id: z.number().optional(),
  imageId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number(),
  base64: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  /** Where the image entered the conversation. Missing means a legacy upload. */
  origin: z.enum(["user-upload", "tool-result", "model-generated"]).optional(),
  /** Provider/model provenance for generated output; never used for routing. */
  generatedBy: z
    .object({
      providerId: z.string(),
      model: z.string()
    })
    .optional(),
  sessionId: z.string().optional(),
  messageId: z.number().optional()
})

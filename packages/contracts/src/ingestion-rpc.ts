import { z } from "zod"

export const IngestionStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
])

export const IngestionPhaseSchema = z.enum([
  "queued",
  "parsing",
  "registering",
  "embedding",
  "committing",
  "completed",
  "compensating"
])

/**
 * Staged parser output returned to the application before it acknowledges and
 * releases the durable job. Bounds keep a malformed worker result from
 * crossing the RPC boundary as unbounded content.
 */
export const ProcessedFileSchema = z
  .object({
    text: z.string().max(20_000_000),
    chunks: z.array(z.string().max(2_000_000)).max(100_000).optional(),
    pages: z
      .array(
        z
          .object({
            pageNumber: z.number().int().positive(),
            text: z.string().max(2_000_000)
          })
          .strict()
      )
      .max(100_000)
      .optional(),
    metadata: z
      .object({
        fileName: z.string().min(1).max(1000),
        fileType: z.string().max(500),
        fileSize: z.number().int().nonnegative(),
        pageCount: z.number().int().nonnegative().optional(),
        processedAt: z.number().int().nonnegative(),
        fileId: z.string().min(1).max(500),
        knowledgeSetId: z.string().min(1).max(500),
        processingTime: z.number().nonnegative().optional()
      })
      .strict()
  })
  .strict()

export const IngestionSubmitRequestSchema = z
  .object({
    jobId: z.string().uuid()
  })
  .strict()

/**
 * Recoverable ingestion snapshot shared by submit, get, and cancel. Status is
 * durable job state; phase identifies the last safe resume/compensation seam.
 */
export const IngestionJobResultSchema = z
  .object({
    jobId: z.string().uuid(),
    fileId: z.string(),
    status: IngestionStatusSchema,
    phase: IngestionPhaseSchema,
    failure: z.string().max(4000).optional(),
    processedFile: ProcessedFileSchema.optional()
  })
  .strict()

export const IngestionSubmitResultSchema = IngestionJobResultSchema
export const IngestionGetRequestSchema = z
  .object({ jobId: z.string().uuid() })
  .strict()
export const IngestionGetResultSchema = IngestionJobResultSchema
export const IngestionCancelRequestSchema = IngestionGetRequestSchema
export const IngestionCancelResultSchema = IngestionJobResultSchema
/**
 * Explicitly releases a staged parse result after the caller has received it.
 * Reading cannot release the only copy because a dropped `ingestions.get`
 * response must remain recoverable.
 */
export const IngestionAckRequestSchema = IngestionGetRequestSchema
export const IngestionAckResultSchema = z
  .object({
    jobId: z.string().uuid(),
    released: z.boolean()
  })
  .strict()

export type IngestionSubmitRequest = z.infer<
  typeof IngestionSubmitRequestSchema
>
export type IngestionJobResult = z.infer<typeof IngestionJobResultSchema>
export type IngestionSubmitResult = z.infer<typeof IngestionSubmitResultSchema>
export type IngestionGetRequest = z.infer<typeof IngestionGetRequestSchema>
export type IngestionGetResult = z.infer<typeof IngestionGetResultSchema>
export type IngestionCancelRequest = z.infer<
  typeof IngestionCancelRequestSchema
>
export type IngestionCancelResult = z.infer<typeof IngestionCancelResultSchema>
export type IngestionAckRequest = z.infer<typeof IngestionAckRequestSchema>
export type IngestionAckResult = z.infer<typeof IngestionAckResultSchema>

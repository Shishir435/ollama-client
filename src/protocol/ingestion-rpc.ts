import { z } from "zod"
import type { RpcDefinition } from "./rpc"
import { RpcMethod } from "./rpc"

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

export type IngestionSubmitRequest = z.infer<
  typeof IngestionSubmitRequestSchema
>
export type IngestionJobResult = z.infer<typeof IngestionJobResultSchema>
export type IngestionGetRequest = z.infer<typeof IngestionGetRequestSchema>

declare module "./provider-rpc" {
  interface RpcMap {
    [RpcMethod.IngestionSubmit]: RpcDefinition<
      IngestionSubmitRequest,
      IngestionJobResult
    >
    [RpcMethod.IngestionGet]: RpcDefinition<
      IngestionGetRequest,
      IngestionJobResult
    >
    [RpcMethod.IngestionCancel]: RpcDefinition<
      IngestionGetRequest,
      IngestionJobResult
    >
  }
}

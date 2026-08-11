import { z } from "zod"
import { AppFailureSchema } from "./app-failure"

export const ModelPullRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
])

/**
 * Recoverable model-pull snapshot. Failures use the shared sanitized failure
 * envelope so raw provider responses never become RPC results.
 */
export const ModelPullJobResultSchema = z
  .object({
    jobId: z.string().uuid(),
    model: z.string().min(1),
    providerId: z.string().optional(),
    status: ModelPullRunStatusSchema,
    statusText: z.string().optional(),
    progress: z.number().int().min(0).max(100).optional(),
    failure: AppFailureSchema.optional()
  })
  .strict()

export const ModelPullSubmitRequestSchema = z
  .object({
    model: z.string().min(1).max(1000),
    providerId: z.string().max(500).optional()
  })
  .strict()
export const ModelPullSubmitResultSchema = ModelPullJobResultSchema

export const ModelPullGetRequestSchema = z
  .object({ jobId: z.string().uuid() })
  .strict()
export const ModelPullGetResultSchema = ModelPullJobResultSchema
export const ModelPullCancelRequestSchema = ModelPullGetRequestSchema
export const ModelPullCancelResultSchema = ModelPullJobResultSchema

export const ModelPullListActiveRequestSchema = z.object({}).strict()
export const ModelPullListActiveResultSchema = z.array(ModelPullJobResultSchema)

export type ModelPullJobResult = z.infer<typeof ModelPullJobResultSchema>
export type ModelPullSubmitRequest = z.infer<
  typeof ModelPullSubmitRequestSchema
>
export type ModelPullSubmitResult = z.infer<typeof ModelPullSubmitResultSchema>
export type ModelPullGetRequest = z.infer<typeof ModelPullGetRequestSchema>
export type ModelPullGetResult = z.infer<typeof ModelPullGetResultSchema>
export type ModelPullCancelRequest = z.infer<
  typeof ModelPullCancelRequestSchema
>
export type ModelPullCancelResult = z.infer<typeof ModelPullCancelResultSchema>
export type ModelPullListActiveRequest = z.infer<
  typeof ModelPullListActiveRequestSchema
>
export type ModelPullListActiveResult = z.infer<
  typeof ModelPullListActiveResultSchema
>

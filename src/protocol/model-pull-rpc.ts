import { AppFailureSchema } from "@ollama-client/contracts/app-failure"
import { type RpcDefinition, RpcMethod } from "@ollama-client/contracts/rpc"
import { z } from "zod"

export const ModelPullRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
])

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

declare module "./provider-rpc" {
  interface RpcMap {
    [RpcMethod.ModelPullSubmit]: RpcDefinition<
      ModelPullSubmitRequest,
      ModelPullJobResult
    >
    [RpcMethod.ModelPullGet]: RpcDefinition<
      { jobId: string },
      ModelPullJobResult
    >
    [RpcMethod.ModelPullCancel]: RpcDefinition<
      { jobId: string },
      ModelPullJobResult
    >
    [RpcMethod.ModelPullListActive]: RpcDefinition<
      Record<string, never>,
      ModelPullJobResult[]
    >
  }
}

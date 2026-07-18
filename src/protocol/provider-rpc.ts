import { z } from "zod"

import type { RpcDefinition } from "./rpc"
import { RpcMethod } from "./rpc"

const ProviderTypeSchema = z.enum(["ollama", "openai", "anthropic", "custom"])
const ProviderServiceProfileSchema = z.enum([
  "generic",
  "openai",
  "anthropic",
  "openrouter"
])

const OpenAICompatibilitySchema = z
  .object({
    maxTokensField: z.enum(["max_tokens", "max_completion_tokens"]).optional(),
    sendStreamOptions: z.enum(["always", "never"]).optional()
  })
  .strict()

export const ProviderConfigInputSchema = z
  .object({
    id: z.string().min(1).max(200),
    type: ProviderTypeSchema,
    enabled: z.boolean(),
    baseUrl: z.string().max(4096).optional(),
    apiKey: z.string().max(32_768).optional(),
    modelId: z.string().max(500).optional(),
    name: z.string().min(1).max(200),
    customModels: z.array(z.string().min(1).max(500)).max(500).optional(),
    serviceProfile: ProviderServiceProfileSchema.optional(),
    compatibility: OpenAICompatibilitySchema.optional()
  })
  .strict()

export const PublicProviderConfigSchema = ProviderConfigInputSchema.omit({
  apiKey: true
})
  .extend({ hasApiKey: z.boolean() })
  .strict()

export type PublicProviderConfig = z.infer<typeof PublicProviderConfigSchema>

const ProviderModelSchema = z.object({
  name: z.string(),
  model: z.string(),
  modified_at: z.string(),
  size: z.number(),
  digest: z.string(),
  providerId: z.string().optional(),
  providerName: z.string().optional(),
  details: z.object({
    parent_model: z.string(),
    format: z.string(),
    family: z.string(),
    families: z.array(z.string()),
    parameter_size: z.string(),
    quantization_level: z.string()
  }),
  capabilityHints: z
    .object({
      modelType: z.string().optional(),
      contextLength: z.number().optional()
    })
    .optional()
})

export const ProvidersListRequestSchema = z.object({}).strict()
export const ProvidersListResultSchema = z
  .object({ providers: z.array(PublicProviderConfigSchema) })
  .strict()

export const ProviderTestConnectionRequestSchema = z.discriminatedUnion(
  "target",
  [
    z
      .object({
        target: z.literal("stored"),
        providerId: z.string().min(1).max(200)
      })
      .strict(),
    z
      .object({
        target: z.literal("draft"),
        config: ProviderConfigInputSchema
      })
      .strict()
  ]
)
export const ProviderTestConnectionResultSchema = z
  .object({
    providerId: z.string(),
    reachable: z.boolean(),
    modelCount: z.number().int().nonnegative(),
    latencyMs: z.number().nonnegative()
  })
  .strict()

export const ProvidersListModelsRequestSchema = z
  .object({
    providerId: z.string().min(1).max(200).optional(),
    enabledOnly: z.boolean().default(true)
  })
  .strict()
export const ProvidersListModelsResultSchema = z
  .object({
    models: z.array(ProviderModelSchema),
    failures: z.array(
      z
        .object({
          providerId: z.string(),
          code: z.string()
        })
        .strict()
    )
  })
  .strict()

export type ProvidersListRequest = z.input<typeof ProvidersListRequestSchema>
export type ProvidersListResult = z.infer<typeof ProvidersListResultSchema>
export type ProviderTestConnectionRequest = z.input<
  typeof ProviderTestConnectionRequestSchema
>
export type ProviderTestConnectionResult = z.infer<
  typeof ProviderTestConnectionResultSchema
>
export type ProvidersListModelsRequest = z.input<
  typeof ProvidersListModelsRequestSchema
>
export type ProvidersListModelsResult = z.infer<
  typeof ProvidersListModelsResultSchema
>

export interface RpcMap {
  [RpcMethod.ProvidersList]: RpcDefinition<
    ProvidersListRequest,
    ProvidersListResult
  >
  [RpcMethod.ProvidersTestConnection]: RpcDefinition<
    ProviderTestConnectionRequest,
    ProviderTestConnectionResult
  >
  [RpcMethod.ProvidersListModels]: RpcDefinition<
    ProvidersListModelsRequest,
    ProvidersListModelsResult
  >
}

export type RpcRequest<M extends RpcMethod> = RpcMap[M]["request"]
export type RpcResponse<M extends RpcMethod> = RpcMap[M]["response"]

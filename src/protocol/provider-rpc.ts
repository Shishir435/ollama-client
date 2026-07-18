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

const ProviderModelSchema = z
  .object({
    name: z.string().min(1),
    model: z.string().nullish(),
    modified_at: z.string().nullish(),
    size: z.number().nullish(),
    digest: z.string().nullish(),
    providerId: z.string().nullish(),
    providerName: z.string().nullish(),
    family: z.string().nullish(),
    details: z
      .object({
        parent_model: z.string().nullish(),
        format: z.string().nullish(),
        family: z.string().nullish(),
        families: z.array(z.string()).nullish(),
        parameter_size: z.string().nullish(),
        quantization_level: z.string().nullish()
      })
      .nullish(),
    capabilityHints: z
      .object({
        modelType: z.string().nullish(),
        contextLength: z.number().nullish(),
        modalities: z.array(z.string()).max(50).nullish(),
        supportedParameters: z.array(z.string()).max(100).nullish()
      })
      .nullish()
  })
  .transform(
    ({
      family,
      details,
      capabilityHints,
      providerId,
      providerName,
      ...model
    }) => {
      const resolvedFamily = details?.family ?? family ?? ""
      const normalizedCapabilityHints = capabilityHints
        ? {
            ...(capabilityHints.modelType && {
              modelType: capabilityHints.modelType
            }),
            ...(capabilityHints.contextLength != null && {
              contextLength: capabilityHints.contextLength
            }),
            ...(capabilityHints.modalities && {
              modalities: capabilityHints.modalities
            }),
            ...(capabilityHints.supportedParameters && {
              supportedParameters: capabilityHints.supportedParameters
            })
          }
        : undefined
      return {
        ...model,
        model: model.model || model.name,
        modified_at: model.modified_at ?? "",
        size: model.size ?? 0,
        digest: model.digest ?? "",
        details: {
          parent_model: details?.parent_model ?? "",
          format: details?.format ?? "",
          family: resolvedFamily,
          families:
            details?.families ?? (resolvedFamily ? [resolvedFamily] : []),
          parameter_size: details?.parameter_size ?? "",
          quantization_level: details?.quantization_level ?? ""
        },
        ...(providerId && { providerId }),
        ...(providerName && { providerName }),
        ...(normalizedCapabilityHints &&
          Object.keys(normalizedCapabilityHints).length > 0 && {
            capabilityHints: normalizedCapabilityHints
          })
      }
    }
  )

export const ProvidersListRequestSchema = z.object({}).strict()
export const ProvidersListResultSchema = z
  .object({ providers: z.array(PublicProviderConfigSchema) })
  .strict()

const NewProviderInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    baseUrl: z.string().min(1).max(4096),
    wire: z.enum(["ollama", "openai", "anthropic"]),
    apiKey: z.string().max(32_768).optional(),
    customModels: z.array(z.string().min(1).max(500)).max(500).optional(),
    serviceProfile: ProviderServiceProfileSchema.optional()
  })
  .strict()

export const ProvidersUpsertRequestSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("existing"),
      config: ProviderConfigInputSchema
    })
    .strict(),
  z
    .object({
      target: z.literal("new"),
      provider: NewProviderInputSchema
    })
    .strict()
])
export const ProvidersUpsertResultSchema = z
  .object({ provider: PublicProviderConfigSchema })
  .strict()

export const ProvidersRemoveRequestSchema = z
  .object({ providerId: z.string().min(1).max(200) })
  .strict()
export const ProvidersRemoveResultSchema = z
  .object({ removedProviderId: z.string() })
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

export const ProvidersProbeModelCapabilitiesRequestSchema = z
  .object({
    providerId: z.string().min(1).max(200),
    modelName: z.string().min(1).max(500)
  })
  .strict()
export const ProvidersProbeModelCapabilitiesResultSchema = z
  .object({
    toolCalling: z.boolean().optional(),
    toolCallingMode: z.enum(["native", "native-user-results"]).optional(),
    reasoning: z.boolean().optional(),
    vision: z.boolean().optional(),
    probedAt: z.number().int().nonnegative()
  })
  .strict()

export type ProvidersListRequest = z.input<typeof ProvidersListRequestSchema>
export type ProvidersListResult = z.infer<typeof ProvidersListResultSchema>
export type ProvidersUpsertRequest = z.input<
  typeof ProvidersUpsertRequestSchema
>
export type ProvidersUpsertResult = z.infer<typeof ProvidersUpsertResultSchema>
export type ProvidersRemoveRequest = z.input<
  typeof ProvidersRemoveRequestSchema
>
export type ProvidersRemoveResult = z.infer<typeof ProvidersRemoveResultSchema>
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
export type ProvidersProbeModelCapabilitiesRequest = z.input<
  typeof ProvidersProbeModelCapabilitiesRequestSchema
>
export type ProvidersProbeModelCapabilitiesResult = z.infer<
  typeof ProvidersProbeModelCapabilitiesResultSchema
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
  [RpcMethod.ProvidersUpsert]: RpcDefinition<
    ProvidersUpsertRequest,
    ProvidersUpsertResult
  >
  [RpcMethod.ProvidersRemove]: RpcDefinition<
    ProvidersRemoveRequest,
    ProvidersRemoveResult
  >
  [RpcMethod.ProvidersProbeModelCapabilities]: RpcDefinition<
    ProvidersProbeModelCapabilitiesRequest,
    ProvidersProbeModelCapabilitiesResult
  >
}

export type RpcRequest<M extends RpcMethod> = RpcMap[M]["request"]
export type RpcResponse<M extends RpcMethod> = RpcMap[M]["response"]

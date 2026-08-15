import { z } from "zod"

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

/**
 * Credential-free provider configuration safe to return to extension pages.
 * `hasApiKey` exposes only whether a secret exists; the secret never crosses
 * the RPC boundary.
 */
export const PublicProviderConfigSchema = ProviderConfigInputSchema.omit({
  apiKey: true
})
  .extend({ hasApiKey: z.boolean() })
  .strict()

/** @see PublicProviderConfigSchema */
export type PublicProviderConfig = z.infer<typeof PublicProviderConfigSchema>

const ProviderApiKeyDraftSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unchanged") }).strict(),
  z
    .object({
      state: z.literal("replaced"),
      value: z.string().max(32_768)
    })
    .strict(),
  z.object({ state: z.literal("cleared") }).strict()
])

/**
 * Editable provider shape used by extension pages. Credentials are represented
 * as an explicit mutation intent; a public config is never widened into the
 * secret-bearing stored shape.
 */
export const ProviderDraftInputSchema = ProviderConfigInputSchema.omit({
  apiKey: true
})
  .extend({ apiKey: ProviderApiKeyDraftSchema })
  .strict()

/** @see ProviderDraftInputSchema */
export type ProviderDraftInput = z.infer<typeof ProviderDraftInputSchema>

export const PROVIDER_MODEL_CLOUD_DESCRIPTION_MAX_LENGTH = 2_000
export const PROVIDER_MODEL_CLOUD_PLAN_MAX_LENGTH = 64

const ProviderModelSchema = z
  .object({
    name: z.string().min(1),
    model: z.string().nullish(),
    modified_at: z.string().nullish(),
    size: z.number().nullish(),
    digest: z.string().nullish(),
    providerId: z.string().nullish(),
    providerName: z.string().nullish(),
    providerBrand: z.string().max(64).nullish(),
    cloud: z
      .object({
        description: z
          .string()
          .max(PROVIDER_MODEL_CLOUD_DESCRIPTION_MAX_LENGTH)
          .nullish(),
        requiredPlan: z
          .string()
          .max(PROVIDER_MODEL_CLOUD_PLAN_MAX_LENGTH)
          .nullish(),
        maxOutputTokens: z.number().int().positive().nullish()
      })
      .nullish(),
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
        capabilityTags: z.array(z.string()).max(50).nullish(),
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
      providerBrand,
      cloud,
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
            ...(capabilityHints.capabilityTags && {
              capabilityTags: capabilityHints.capabilityTags
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
        ...(providerBrand && { providerBrand }),
        ...(cloud && {
          cloud: {
            ...(cloud.description && { description: cloud.description }),
            ...(cloud.requiredPlan && { requiredPlan: cloud.requiredPlan }),
            ...(cloud.maxOutputTokens != null && {
              maxOutputTokens: cloud.maxOutputTokens
            })
          }
        }),
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
      config: ProviderDraftInputSchema
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

/**
 * Narrow enable/disable toggle. Deliberately not expressed as a full
 * `providers.upsert`: that requires the whole config, so a caller holding only
 * the public (apiKey-stripped) shape would have to round-trip credentials it
 * cannot see. This maps to a partial `updateProviderConfig` instead.
 */
export const ProvidersSetEnabledRequestSchema = z
  .object({
    providerId: z.string().min(1).max(200),
    enabled: z.boolean()
  })
  .strict()
export const ProvidersSetEnabledResultSchema = z
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
        config: ProviderDraftInputSchema
      })
      .strict()
  ]
)
export const ProviderTestConnectionResultSchema = z
  .object({
    providerId: z.string(),
    reachable: z.boolean(),
    modelCount: z.number().int().nonnegative(),
    /**
     * False when a reachable, usable server has no model-list endpoint. This
     * is distinct from connection failure so importers do not treat catalog
     * support as proof of reachability.
     */
    modelListSupported: z.boolean(),
    latencyMs: z.number().nonnegative()
  })
  .strict()

/**
 * Why a provider contributed nothing to a model list. Three different things,
 * and callers act on the difference: only the first two mean something went
 * wrong, and only the first means the provider has no usable models at all.
 *
 * Named here rather than spelled out at each call site — they cross the RPC
 * boundary, so a typo on one side is a silent behaviour change on the other.
 */
export const MODEL_DISCOVERY_FAILURE = {
  /** Discovery failed and nothing covered for it. */
  REQUEST_FAILED: "request_failed",
  /** Discovery failed, but the provider's declared model ids carried the list. */
  DISCOVERY_UNAVAILABLE: "discovery_unavailable",
  /** The endpoint publishes no catalog and no model ids were declared. */
  MODEL_LIST_UNSUPPORTED: "model_list_unsupported"
} as const

export type ModelDiscoveryFailureCode =
  (typeof MODEL_DISCOVERY_FAILURE)[keyof typeof MODEL_DISCOVERY_FAILURE]

export const ProvidersListModelsRequestSchema = z
  .object({
    providerId: z.string().min(1).max(200).optional(),
    enabledOnly: z.boolean().default(true)
  })
  .strict()
/**
 * Provider-neutral model discovery result. Sparse provider metadata is
 * normalized to empty display values, while capability hints remain optional
 * so absence continues to mean unknown rather than unsupported.
 */
export const ProvidersListModelsResultSchema = z
  .object({
    models: z.array(ProviderModelSchema),
    failures: z.array(
      z
        .object({
          providerId: z.string(),
          providerName: z.string().optional(),
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
    /**
     * Checks that did not finish, so the caller can say so instead of leaving
     * the user to read a failed probe as an unsupported capability.
     */
    incomplete: z
      .array(z.enum(["toolCalling", "reasoning", "vision"]))
      .optional(),
    probedAt: z.number().int().nonnegative()
  })
  .strict()

export const ProvidersIconsRequestSchema = z.object({}).strict()
/**
 * Icons fetched from providers we have no curated mark for, as `data:` URIs so
 * the page makes no network request of its own. Kept off the model rows: one
 * icon can outweigh every model a provider serves, and it belongs to the
 * provider, not to each model.
 */
export const ProvidersIconsResultSchema = z
  .object({
    icons: z
      .array(
        z
          .object({
            providerId: z.string().min(1).max(200),
            dataUrl: z.string().startsWith("data:image/").max(65_536)
          })
          .strict()
      )
      .max(200)
  })
  .strict()

export type ProvidersIconsRequest = z.input<typeof ProvidersIconsRequestSchema>
export type ProvidersIconsResult = z.infer<typeof ProvidersIconsResultSchema>

export type ProvidersListRequest = z.input<typeof ProvidersListRequestSchema>
export type ProvidersListResult = z.infer<typeof ProvidersListResultSchema>
export type ProvidersUpsertRequest = z.input<
  typeof ProvidersUpsertRequestSchema
>
export type ProvidersUpsertResult = z.infer<typeof ProvidersUpsertResultSchema>
export type ProvidersSetEnabledRequest = z.input<
  typeof ProvidersSetEnabledRequestSchema
>
export type ProvidersSetEnabledResult = z.infer<
  typeof ProvidersSetEnabledResultSchema
>
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
/**
 * Normalized provider model list plus per-provider discovery failure reasons.
 * @see ProvidersListModelsResultSchema
 */
export type ProvidersListModelsResult = z.infer<
  typeof ProvidersListModelsResultSchema
>
export type ProvidersProbeModelCapabilitiesRequest = z.input<
  typeof ProvidersProbeModelCapabilitiesRequestSchema
>
export type ProvidersProbeModelCapabilitiesResult = z.infer<
  typeof ProvidersProbeModelCapabilitiesResultSchema
>

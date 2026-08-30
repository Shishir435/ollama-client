import { z } from "zod"

const EmbeddingVectorSchema = z.array(z.number().finite()).min(1).max(100_000)

export const EmbeddingsGenerateRequestSchema = z
  .object({
    text: z.string().max(2_000_000),
    model: z.string().min(1).max(500).optional()
  })
  .strict()

export const EmbeddingsGenerateResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      embedding: EmbeddingVectorSchema,
      model: z.string().min(1).max(500),
      providerId: z.string().min(1).max(200)
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.string().max(2_000),
      code: z.string().max(100).optional()
    })
    .strict()
])

/**
 * Model lifecycle and catalog methods.
 *
 * These replace the last request/response `MESSAGE_KEYS` handlers. They are
 * split from `provider-rpc.ts` because they act on a *model* — the provider is
 * a routing hint, resolved server-side — while `providers.*` acts on stored
 * provider configuration.
 */

const ModelRefSchema = z
  .object({
    model: z.string().min(1).max(500),
    providerId: z.string().min(1).max(200).optional()
  })
  .strict()

const ModelDetailsSchema = z
  .object({
    details: z
      .object({
        parent_model: z.string().default(""),
        format: z.string().default(""),
        family: z.string().default(""),
        families: z.array(z.string()).max(100).default([]),
        parameter_size: z.string().default(""),
        quantization_level: z.string().default("")
      })
      .optional(),
    /**
     * Opaque Ollama `/api/show` metadata. Keys vary by model architecture, so
     * consumers must not assume a fixed shape.
     */
    model_info: z.record(z.string(), z.unknown()).optional(),
    capabilities: z.array(z.string().max(100)).max(50).optional()
  })
  .strict()

export const ModelsGetDetailsRequestSchema = ModelRefSchema

/**
 * Provider-neutral model details returned across the extension RPC boundary.
 *
 * Detail fields are defaulted instead of optional because providers report
 * different subsets while model-card consumers render every field. Missing
 * strings become `""` and missing families become `[]`, so importers do not
 * need provider-specific `undefined` handling. `model_info` remains an opaque
 * map because Ollama keys vary by model architecture.
 */
export const ModelsGetDetailsResultSchema = z
  .object({
    /** The provider the worker actually resolved the model to. */
    providerId: z.string(),
    /** Whether that provider can self-report details at all. */
    supportsDetails: z.boolean(),
    details: ModelDetailsSchema.nullable()
  })
  .strict()

/**
 * One shape for every provider's "currently resident" answer. Ollama's
 * `/api/ps` and LM Studio's model list disagree on field names, and the caller
 * renders one card either way — so normalization belongs here, not in the UI.
 */
const LoadedModelSchema = z
  .object({
    name: z.string(),
    sizeBytes: z.number().nonnegative(),
    family: z.string(),
    parameterSize: z.string(),
    quantizationLevel: z.string()
  })
  .strict()

export const ModelsListLoadedRequestSchema = z
  .object({ providerId: z.string().min(1).max(200).optional() })
  .strict()
/**
 * Normalized resident-model list shared by providers with incompatible native
 * responses. Missing provider values are represented by empty strings or zero
 * before this schema is reached, keeping provider branching out of importers.
 */
export const ModelsListLoadedResultSchema = z
  .object({ models: z.array(LoadedModelSchema).max(200) })
  .strict()

export const ModelsUnloadRequestSchema = ModelRefSchema
export const ModelsUnloadResultSchema = z
  .object({ unloaded: z.boolean() })
  .strict()

export const ModelsWarmupRequestSchema = z
  .object({
    model: z.string().min(1).max(500),
    providerId: z.string().min(1).max(200).optional(),
    previousModel: z.string().min(1).max(500).optional(),
    previousProviderId: z.string().min(1).max(200).optional()
  })
  .strict()
export const ModelsWarmupResultSchema = z
  .object({
    /** False when the model's config opts out or the cooldown has not elapsed. */
    warmed: z.boolean(),
    /** True when switching away unloaded the previous model. */
    unloadedPrevious: z.boolean()
  })
  .strict()

/**
 * The library pages are fetched in the background and parsed by the caller:
 * `DOMParser` does not exist in an MV3 service worker. The HTML is remote,
 * untrusted, and only ever parsed into a name/description list — the cap keeps
 * a hostile or broken response from crossing the boundary unbounded.
 */
const LibraryHtmlSchema = z.string().max(4_000_000)

export const ModelsSearchLibraryRequestSchema = z
  .object({ query: z.string().min(1).max(200) })
  .strict()
/**
 * Bounded remote library HTML for parsing in an extension page. HTML crosses
 * the boundary because MV3 service workers have no `DOMParser`; callers must
 * treat it as untrusted and extract only the supported model metadata.
 */
export const ModelsSearchLibraryResultSchema = z
  .object({ html: LibraryHtmlSchema })
  .strict()

export const ModelsGetLibraryVariantsRequestSchema = z
  .object({ name: z.string().min(1).max(200) })
  .strict()
/** @see ModelsSearchLibraryResultSchema */
export const ModelsGetLibraryVariantsResultSchema = z
  .object({ html: LibraryHtmlSchema })
  .strict()

export const EmbeddingsCheckModelRequestSchema = z
  .object({
    model: z.string().min(1).max(500).optional(),
    providerId: z.string().min(1).max(200).optional()
  })
  .strict()
export const EmbeddingsCheckModelResultSchema = z
  .object({
    exists: z.boolean(),
    /**
     * Resolution trace for the diagnostics log. Bounded and content-free — it
     * carries provider ids and endpoint classes, never prompts or credentials.
     */
    debug: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

export const EmbeddingsPrepareModelRequestSchema = z
  .object({
    model: z.string().min(1).max(500).optional(),
    providerId: z.string().min(1).max(200).optional()
  })
  .strict()
export const EmbeddingsPrepareModelResultSchema = z
  .object({
    ready: z.boolean(),
    prepared: z.boolean(),
    error: z.string().max(2000).optional()
  })
  .strict()

export type ModelsGetDetailsRequest = z.input<
  typeof ModelsGetDetailsRequestSchema
>
/**
 * Provider-neutral details with display fields normalized to empty values.
 * @see ModelsGetDetailsResultSchema
 */
export type ModelsGetDetailsResult = z.infer<
  typeof ModelsGetDetailsResultSchema
>
export type ModelsListLoadedRequest = z.input<
  typeof ModelsListLoadedRequestSchema
>
/** Provider-neutral resident-model collection. */
export type ModelsListLoadedResult = z.infer<
  typeof ModelsListLoadedResultSchema
>
/**
 * One provider-neutral resident-model row; unavailable values use `""` or `0`.
 * @see ModelsListLoadedResultSchema
 */
export type LoadedModel = z.infer<typeof LoadedModelSchema>
export type ModelsUnloadRequest = z.input<typeof ModelsUnloadRequestSchema>
export type ModelsUnloadResult = z.infer<typeof ModelsUnloadResultSchema>
export type ModelsWarmupRequest = z.input<typeof ModelsWarmupRequestSchema>
export type ModelsWarmupResult = z.infer<typeof ModelsWarmupResultSchema>
export type ModelsSearchLibraryRequest = z.input<
  typeof ModelsSearchLibraryRequestSchema
>
/** Bounded, untrusted HTML intended for extension-page parsing. */
export type ModelsSearchLibraryResult = z.infer<
  typeof ModelsSearchLibraryResultSchema
>
export type ModelsGetLibraryVariantsRequest = z.input<
  typeof ModelsGetLibraryVariantsRequestSchema
>
/** Bounded, untrusted HTML intended for extension-page parsing. */
export type ModelsGetLibraryVariantsResult = z.infer<
  typeof ModelsGetLibraryVariantsResultSchema
>
export type EmbeddingsCheckModelRequest = z.input<
  typeof EmbeddingsCheckModelRequestSchema
>
export type EmbeddingsCheckModelResult = z.infer<
  typeof EmbeddingsCheckModelResultSchema
>
export type EmbeddingsPrepareModelRequest = z.input<
  typeof EmbeddingsPrepareModelRequestSchema
>
export type EmbeddingsPrepareModelResult = z.infer<
  typeof EmbeddingsPrepareModelResultSchema
>
export type EmbeddingsGenerateRequest = z.input<
  typeof EmbeddingsGenerateRequestSchema
>
export type EmbeddingsGenerateResult = z.infer<
  typeof EmbeddingsGenerateResultSchema
>

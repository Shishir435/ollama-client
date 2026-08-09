import {
  MODEL_DISCOVERY_FAILURE,
  type ProvidersIconsResult,
  type ProvidersListModelsRequest,
  type ProvidersListModelsResult,
  type ProvidersListResult,
  type ProvidersProbeModelCapabilitiesRequest,
  type ProvidersProbeModelCapabilitiesResult,
  type ProvidersRemoveRequest,
  type ProvidersRemoveResult,
  type ProvidersSetEnabledRequest,
  type ProvidersSetEnabledResult,
  type ProvidersUpsertRequest,
  type ProvidersUpsertResult,
  type ProviderTestConnectionRequest,
  type ProviderTestConnectionResult,
  type PublicProviderConfig
} from "@ollama-client/contracts/provider-rpc"
import { createAppError, isAbortError, isAppError } from "@/lib/error-utils"
import type { ChatStreamMessage } from "@/types/chat"
import type { ProviderModel } from "@/types/model"

import {
  probeReasoning,
  probeToolCalling,
  probeVision,
  setCapabilityProbe
} from "./capability-probe"
import { ProviderFactory } from "./factory"
import { ProviderManager } from "./manager"
import {
  clearModelCatalogSupport,
  isCatalogAbsentStatus,
  recordModelCatalogSupport,
  shouldSkipModelCatalog
} from "./model-catalog-support"
import { resolveProviderBrand } from "./provider-brand"
import {
  clearAllProviderFavicons,
  clearProviderFavicon,
  isFaviconLookupEnabled,
  resolveProviderFavicon
} from "./provider-favicon"
import type { LLMProvider, ProviderConfig } from "./types"

const toPublicConfig = (config: ProviderConfig): PublicProviderConfig => {
  return {
    id: String(config.id),
    type: config.type,
    enabled: config.enabled,
    ...(config.baseUrl !== undefined && { baseUrl: config.baseUrl }),
    ...(config.modelId !== undefined && { modelId: config.modelId }),
    name: config.name,
    ...(config.customModels !== undefined && {
      customModels: config.customModels
    }),
    ...(config.serviceProfile !== undefined && {
      serviceProfile: config.serviceProfile
    }),
    ...(config.compatibility !== undefined && {
      compatibility: {
        ...(config.compatibility.maxTokensField !== undefined && {
          maxTokensField: config.compatibility.maxTokensField
        }),
        ...(config.compatibility.sendStreamOptions !== undefined && {
          sendStreamOptions: config.compatibility.sendStreamOptions
        })
      }
    }),
    hasApiKey: Boolean(config.apiKey?.trim())
  }
}

const customModel = (name: string, config: ProviderConfig): ProviderModel => ({
  name,
  model: name,
  modified_at: new Date().toISOString(),
  size: 0,
  digest: String(config.id),
  providerId: String(config.id),
  providerName: config.name,
  details: {
    parent_model: "",
    format: "gguf",
    family: config.type,
    families: [],
    parameter_size: "",
    quantization_level: ""
  }
})

/**
 * "This server has no model-list endpoint", as opposed to "this server is
 * broken or refused you". Every other failure — no answer at all, 401, 429,
 * 5xx — stays a failure and keeps its own message, because calling those
 * reachable would hide a problem the user has to fix.
 */
const isModelListAbsent = (error: unknown): boolean =>
  isAppError(error) && isCatalogAbsentStatus(error.status)

/**
 * Confirm a catalog-less endpoint by asking it to generate one token.
 *
 * A 404 from `/models` is ambiguous: it is what a chat-only gateway answers,
 * and it is also what a mistyped base URL answers. Treating both as "reachable"
 * would report a broken configuration as a working provider and then hide the
 * mistake behind a remembered answer. The chat endpoint is the one the user
 * actually needs, so that is what gets checked.
 *
 * Runs only on an explicit connection test, and only when the user has declared
 * a model id to send — never on the background health check, which must not
 * spend inference on someone's metered endpoint.
 */
const CHAT_PROBE_TIMEOUT_MS = 20_000

/**
 * Model output, as opposed to the stream's own bookkeeping. Every stream ends
 * with a `done` chunk, including the one an HTTP 200 with an empty body
 * produces — and a proxy or a login page answers 200 as readily as a chat
 * route does. Only something the model generated says a completion happened
 * here.
 */
const isModelOutput = (chunk: ChatStreamMessage): boolean =>
  Boolean(chunk.delta || chunk.thinkingDelta || chunk.toolCalls?.length)

const emptyChatResponse = (provider: LLMProvider) =>
  createAppError("The chat endpoint answered without generating anything", {
    kind: "provider",
    status: 502,
    providerId: String(provider.id),
    code: "OLC-PROVIDER-UNREACHABLE",
    recoveryAction: "test-connection",
    userMessage:
      "Something answered at that address, but it produced no output — so it is not a chat endpoint, or the model id is not one it serves. Check the base URL and the model IDs you added."
  })

const probeChatEndpoint = async (
  provider: LLMProvider,
  model: string,
  signal?: AbortSignal
): Promise<void> => {
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(signal?.reason)
  if (signal?.aborted) abortFromCaller()
  else signal?.addEventListener("abort", abortFromCaller, { once: true })
  let answered = false
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CHAT_PROBE_TIMEOUT_MS)

  try {
    await provider.streamChat(
      {
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        num_predict: 1,
        think: false
      },
      // The first token proves the route exists; nothing is gained by paying
      // for the rest of the answer.
      (chunk) => {
        if (!isModelOutput(chunk)) return
        answered = true
        controller.abort()
      },
      controller.signal
    )
    // A stream that ended without generating anything is not a confirmation.
    // An endpoint that is not a chat route at all answers 200 and closes, and
    // that arrives here looking exactly like a completed request.
    if (!answered) throw emptyChatResponse(provider)
  } catch (error) {
    // The caller's cancellation is theirs. Ours means the probe got what it
    // came for — but only the abort the first chunk fired. The timeout aborts
    // an endpoint that never answered at all, and reporting that as a working
    // provider is the mistake this probe exists to prevent.
    if (signal?.aborted) throw error
    if (answered) return
    if (timedOut) {
      throw createAppError(
        `No response from the chat endpoint within ${
          CHAT_PROBE_TIMEOUT_MS / 1000
        }s`,
        {
          kind: "provider",
          status: 504,
          providerId: String(provider.id),
          code: "OLC-PROVIDER-TIMEOUT",
          recoveryAction: "retry",
          userMessage: `The chat endpoint accepted the request but sent nothing back within ${
            CHAT_PROBE_TIMEOUT_MS / 1000
          } seconds. The server may be loading the model, or the model id may not be one it serves.`,
          cause: error
        }
      )
    }
    if (isAbortError(error)) return
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", abortFromCaller)
  }
}

/**
 * Run {@link probeChatEndpoint} and turn its verdict into the one thing the
 * caller wants to know: is there a usable provider at this base URL?
 *
 * A chat route that is missing as well means the base URL is wrong, not that
 * the provider is catalog-less — so it says so, and drops the remembered
 * catalog answer that was recorded on the way here. Anything else (a refused
 * key, a rate limit, a server error) is reported as itself.
 */
const confirmChatEndpoint = async (
  provider: LLMProvider,
  config: ProviderConfig | undefined,
  model: string,
  signal?: AbortSignal
): Promise<boolean> => {
  try {
    await probeChatEndpoint(provider, model, signal)
    return true
  } catch (error) {
    if (signal?.aborted) throw error
    if (!isAppError(error) || !isCatalogAbsentStatus(error.status)) throw error
    if (config) {
      await clearModelCatalogSupport(String(config.id)).catch(() => undefined)
    }
    const endpoint = config?.baseUrl?.trim()
    throw createAppError(
      `Neither the model list nor the chat endpoint exists at ${endpoint ?? "the configured base URL"}`,
      {
        kind: "provider",
        status: error.status,
        providerId: String(provider.id),
        providerName: config?.name,
        baseUrl: endpoint,
        code: "OLC-PROVIDER-UNREACHABLE",
        recoveryAction: "test-connection",
        userMessage: `Nothing answered at ${
          endpoint ?? "the configured base URL"
        }: neither a model list nor a chat endpoint is there. Check the base URL — hosted providers usually need the version suffix, such as /v1.`,
        cause: error
      }
    )
  }
}

/**
 * Ask a provider for its catalog, unless it has already answered that it has
 * none. Returns the discovered models and what was learned, so callers do not
 * each have to re-derive "was that a failure or just an absent endpoint".
 */
const discoverModels = async (
  config: ProviderConfig | undefined,
  resolveProvider: () => Promise<Pick<LLMProvider, "getModels">>,
  signal?: AbortSignal,
  options: { force?: boolean } = {}
): Promise<{
  models: ProviderModel[]
  catalog: "present" | "absent" | "failed"
  error?: unknown
}> => {
  const remember = (supported: boolean) =>
    config ? recordModelCatalogSupport(config, supported) : Promise.resolve()
  if (
    config &&
    !options.force &&
    (await shouldSkipModelCatalog(config).catch(() => false))
  ) {
    return { models: [], catalog: "absent" }
  }
  try {
    const provider = await resolveProvider()
    const models = await provider.getModels(signal)
    await remember(true).catch(() => undefined)
    return { models, catalog: "present" }
  } catch (error) {
    if (signal?.aborted) throw error
    if (!isModelListAbsent(error)) {
      return { models: [], catalog: "failed", error }
    }
    await remember(false).catch(() => undefined)
    return { models: [], catalog: "absent" }
  }
}

const mergeProviderModels = (
  models: ProviderModel[],
  config: ProviderConfig
): ProviderModel[] => {
  const byName = new Map(models.map((model) => [model.name, model]))
  for (const name of config.customModels ?? []) {
    if (!byName.has(name)) byName.set(name, customModel(name, config))
  }
  /*
   * The vendor mark is resolved here, not in the UI: it is read off the base
   * URL and service profile, and neither crosses the RPC boundary with a model
   * row. Every model a provider contributes therefore carries the brand its
   * configuration implies.
   */
  const brand = resolveProviderBrand({
    id: String(config.id),
    baseUrl: config.baseUrl,
    name: config.name,
    serviceProfile: config.serviceProfile
  })
  return [...byName.values()].map((model) => ({
    ...model,
    providerId: model.providerId || String(config.id),
    providerName: model.providerName || config.name,
    ...(brand && { providerBrand: brand })
  }))
}

export const ProviderRpcService = {
  async list(): Promise<ProvidersListResult> {
    const providers = await ProviderManager.getProviders()
    return { providers: providers.map(toPublicConfig) }
  },

  /**
   * Site icons for providers that have no curated mark. Only those are asked:
   * a recognized vendor already has a better icon than its own favicon, and
   * spending a request to fetch a worse one would be pure cost.
   */
  async icons(
    _request: unknown,
    signal?: AbortSignal
  ): Promise<ProvidersIconsResult> {
    /*
     * Turning the lookup off drops what was already fetched, so the setting
     * means "do not keep provider icons" rather than only "do not fetch more".
     * The purge is idempotent and re-derivable, so it is safe in a query.
     */
    if (!(await isFaviconLookupEnabled())) {
      await clearAllProviderFavicons().catch(() => undefined)
      return { icons: [] }
    }

    const providers = await ProviderManager.getProviders()
    const candidates = providers.filter(
      (config) =>
        config.enabled &&
        !resolveProviderBrand({
          id: String(config.id),
          baseUrl: config.baseUrl,
          name: config.name,
          serviceProfile: config.serviceProfile
        })
    )

    const resolved = await Promise.all(
      candidates.map(async (config) => ({
        providerId: String(config.id),
        dataUrl: await resolveProviderFavicon(config, signal).catch(() => null)
      }))
    )

    return {
      icons: resolved.filter(
        (icon): icon is { providerId: string; dataUrl: string } =>
          typeof icon.dataUrl === "string"
      )
    }
  },

  async testConnection(
    request: ProviderTestConnectionRequest,
    signal?: AbortSignal
  ): Promise<ProviderTestConnectionResult> {
    const startedAt = performance.now()
    const resolved =
      request.target === "draft"
        ? await (async () => {
            const draft = request.config as ProviderConfig
            const stored =
              draft.apiKey === undefined
                ? await ProviderManager.getProviderConfig(String(draft.id))
                : undefined
            const config = {
              ...draft,
              ...(draft.apiKey === undefined && stored?.apiKey
                ? { apiKey: stored.apiKey }
                : {})
            }
            return {
              config,
              provider: await ProviderFactory.getProviderWithConfig(config)
            }
          })()
        : {
            config: await ProviderManager.getProviderConfig(request.providerId),
            provider: await ProviderFactory.getProvider(request.providerId)
          }
    const { config, provider } = resolved
    /*
     * A draft test is the user pressing Test, usually right after editing the
     * config, so it always goes to the network. A stored test is the background
     * health check, which honours the remembered answer — that is what stops a
     * chat-only endpoint from collecting a 404 every few seconds forever.
     */
    const { models, catalog, error } = await discoverModels(
      config,
      async () => provider,
      signal,
      { force: request.target === "draft" }
    )
    if (catalog === "failed") throw error

    const merged = config ? mergeProviderModels(models, config) : models
    /*
     * Declared model ids count toward what this endpoint can be used with,
     * exactly as they do in `listModels`. A hosted router that only implements
     * `/chat/completions` is not broken — it just has nothing to discover.
     *
     * "Nothing to discover" is not the same as "works", though, and the
     * catalog request cannot tell the difference: a mistyped base URL answers
     * 404 exactly like a chat-only gateway does. So an explicit test confirms
     * the endpoint the user actually needs before reporting it reachable, and
     * a test that cannot confirm it does not claim to have.
     */
    const reachable =
      catalog === "present" ||
      (request.target === "draft" &&
        merged.length > 0 &&
        (await confirmChatEndpoint(provider, config, merged[0].name, signal)))

    return {
      providerId: String(provider.id),
      reachable,
      modelCount: merged.length,
      modelListSupported: catalog === "present",
      latencyMs: Math.max(0, performance.now() - startedAt)
    }
  },

  async upsert(
    request: ProvidersUpsertRequest
  ): Promise<ProvidersUpsertResult> {
    if (request.target === "new") {
      const config = await ProviderManager.addCustomProvider(
        request.provider as Parameters<
          typeof ProviderManager.addCustomProvider
        >[0]
      )
      return { provider: toPublicConfig(config) }
    }

    const id = String(request.config.id)
    const existing = await ProviderManager.getProviderConfig(id)
    if (!existing) {
      throw createAppError(`Provider ${id} not found`, {
        kind: "provider",
        status: 404,
        providerId: id,
        userMessage: "Provider configuration was not found"
      })
    }
    if (request.config.type !== existing.type) {
      throw createAppError("A provider's wire protocol cannot be changed", {
        kind: "validation",
        status: 400,
        providerId: id,
        userMessage:
          "Provider protocol cannot be changed. Add a new provider instead."
      })
    }
    await ProviderManager.updateProviderConfig(
      id,
      request.config as ProviderConfig
    )
    const saved = await ProviderManager.getProviderConfig(id)
    if (!saved) {
      throw createAppError(`Provider ${id} disappeared after update`, {
        kind: "provider",
        status: 500,
        providerId: id,
        userMessage: "Provider configuration could not be saved"
      })
    }
    return { provider: toPublicConfig(saved) }
  },

  async setEnabled(
    request: ProvidersSetEnabledRequest
  ): Promise<ProvidersSetEnabledResult> {
    const { providerId, enabled } = request
    const existing = await ProviderManager.getProviderConfig(providerId)
    if (!existing) {
      throw createAppError(`Provider ${providerId} not found`, {
        kind: "provider",
        status: 404,
        providerId,
        userMessage: "Provider configuration was not found"
      })
    }
    // Partial update: everything except `enabled` — including the API key the
    // caller never receives — stays exactly as stored.
    await ProviderManager.updateProviderConfig(providerId, { enabled })
    const saved = await ProviderManager.getProviderConfig(providerId)
    if (!saved) {
      throw createAppError(`Provider ${providerId} disappeared after update`, {
        kind: "provider",
        status: 500,
        providerId,
        userMessage: "Provider configuration could not be saved"
      })
    }
    return { provider: toPublicConfig(saved) }
  },

  async remove(
    request: ProvidersRemoveRequest
  ): Promise<ProvidersRemoveResult> {
    await ProviderManager.removeCustomProvider(request.providerId)
    // The cached icon outlives the provider otherwise, and a later provider
    // reusing the id would inherit it.
    await clearProviderFavicon(request.providerId).catch(() => undefined)
    return { removedProviderId: request.providerId }
  },

  async listModels(
    request: ProvidersListModelsRequest,
    signal?: AbortSignal
  ): Promise<ProvidersListModelsResult> {
    const providers = await ProviderManager.getProviders()
    const selected = providers.filter((provider) => {
      if (request.providerId) {
        return String(provider.id) === request.providerId
      }
      return request.enabledOnly === false || provider.enabled
    })
    if (request.providerId && selected.length === 0) {
      throw createAppError(`Provider ${request.providerId} not found`, {
        kind: "provider",
        status: 404,
        providerId: request.providerId,
        userMessage: "Provider configuration was not found"
      })
    }

    const models: ProviderModel[] = []
    const failures: ProvidersListModelsResult["failures"] = []
    await Promise.all(
      selected.map(async (config) => {
        const { models: discovered, catalog } = await discoverModels(
          config,
          () => ProviderFactory.getProvider(String(config.id)),
          signal
        )
        /*
         * Declared model ids are configuration, not discovery. Merging them
         * only on the success path meant a provider without a `/models`
         * endpoint contributed nothing at all — its ids were typed in, stored,
         * and then dropped on the floor, so the model menu never showed the
         * provider and the user had no way to reach it.
         */
        const merged = mergeProviderModels(discovered, config)
        models.push(...merged)
        const report = (code: string) =>
          failures.push({
            providerId: String(config.id),
            providerName: config.name,
            code
          })
        if (catalog === "failed") {
          report(
            merged.length > 0
              ? MODEL_DISCOVERY_FAILURE.DISCOVERY_UNAVAILABLE
              : MODEL_DISCOVERY_FAILURE.REQUEST_FAILED
          )
          return
        }
        // A catalog-less provider carrying its own declared ids is a normal,
        // working setup. It is only worth reporting when it has none, because
        // then it contributes nothing and the user has to add some.
        if (catalog === "absent" && merged.length === 0) {
          report(MODEL_DISCOVERY_FAILURE.MODEL_LIST_UNSUPPORTED)
        }
      })
    )

    /*
     * Only a set of providers that all genuinely failed is an error. An
     * endpoint that simply publishes no catalog has not failed at anything —
     * throwing there would replace "add model IDs for this provider" with a
     * network error, which is neither true nor actionable.
     */
    const hardFailures = failures.filter(
      ({ code }) => code !== MODEL_DISCOVERY_FAILURE.MODEL_LIST_UNSUPPORTED
    )
    if (
      models.length === 0 &&
      selected.length > 0 &&
      hardFailures.length === selected.length
    ) {
      throw createAppError(
        "Failed to fetch models from every selected provider",
        {
          kind: "provider",
          retryable: true,
          userMessage: "Failed to fetch models from the configured providers",
          debug: failures.map(({ providerId }) => providerId)
        }
      )
    }

    models.sort((left, right) => left.name.localeCompare(right.name))
    failures.sort((left, right) =>
      left.providerId.localeCompare(right.providerId)
    )
    return { models, failures }
  },

  async probeModelCapabilities(
    request: ProvidersProbeModelCapabilitiesRequest,
    signal?: AbortSignal
  ): Promise<ProvidersProbeModelCapabilitiesResult> {
    const provider = await ProviderFactory.getProvider(request.providerId)

    /*
     * One probe at a time, on purpose.
     *
     * These ran concurrently, which is self-defeating against a local
     * single-model server: three generations arrive at once, the server serializes
     * them behind a cold model load anyway, and the later ones burn their 30s
     * timeout waiting in that queue. The symptom was a first Detect reporting
     * tool calling and vision while reasoning timed out, then a second Detect
     * finding reasoning because the model was warm by then.
     *
     * Sequential pays the model load once, on the first probe, and each check
     * then gets its full timeout for its own work.
     */
    const tool = await Promise.allSettled([
      probeToolCalling(provider, request.modelName, signal)
    ]).then(([outcome]) => outcome)
    const reasoning = await Promise.allSettled([
      probeReasoning(provider, request.modelName, signal)
    ]).then(([outcome]) => outcome)
    const vision = await Promise.allSettled([
      probeVision(provider, request.modelName, signal)
    ]).then(([outcome]) => outcome)

    if (
      tool.status === "rejected" &&
      reasoning.status === "rejected" &&
      vision.status === "rejected"
    ) {
      throw tool.reason
    }

    const result: ProvidersProbeModelCapabilitiesResult = {
      probedAt: Date.now()
    }
    const incomplete: Array<"toolCalling" | "reasoning" | "vision"> = []
    if (tool.status === "fulfilled") {
      result.toolCalling = tool.value.toolCalling
      result.toolCallingMode = tool.value.toolCallingMode
    } else {
      incomplete.push("toolCalling")
    }
    if (reasoning.status === "fulfilled") {
      result.reasoning = reasoning.value.reasoning
    } else {
      incomplete.push("reasoning")
    }
    if (
      vision.status === "fulfilled" &&
      typeof vision.value.vision === "boolean"
    ) {
      result.vision = vision.value.vision
    } else if (vision.status === "rejected") {
      incomplete.push("vision")
    }
    // A check that never returned is not the same as one that returned "no";
    // without this the sheet shows an unsupported toggle either way.
    if (incomplete.length > 0) result.incomplete = incomplete
    signal?.throwIfAborted()
    // `incomplete` describes this run, not the model, so it is reported to the
    // caller but never merged into the stored evidence.
    const { incomplete: _incomplete, ...persisted } = result
    await setCapabilityProbe(request.providerId, request.modelName, persisted)
    return result
  }
}

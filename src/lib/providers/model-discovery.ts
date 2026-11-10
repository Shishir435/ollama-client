import { createAppError, isAppError } from "@/lib/error-utils"
import type { ProviderModel } from "@/types/model"
import { resolveProviderBaseUrl } from "./base-url"
import {
  isCatalogAbsentStatus,
  recordModelCatalogSupport,
  shouldSkipModelCatalog
} from "./model-catalog-support"
import type { LLMProvider, ProviderConfig } from "./types"

/**
 * "This server has no model-list endpoint", as opposed to "this server is
 * broken or refused you". Every other failure — no answer at all, 401, 429,
 * 5xx — stays a failure and keeps its own message, because calling those
 * reachable would hide a problem the user has to fix.
 */
const isModelListAbsent = (error: unknown): boolean =>
  isAppError(error) && isCatalogAbsentStatus(error.status)

/** What a discovery attempt learned, beyond the models it returned. */
export type ModelCatalogVerdict = "present" | "absent" | "failed"

export interface ModelDiscoveryResult {
  models: ProviderModel[]
  catalog: ModelCatalogVerdict
  /** Set only when `catalog` is `"failed"`; the caller decides whether to throw. */
  error?: unknown
}

/**
 * A discovery failure that is not a remembered absence travels back to the
 * caller as-is, but only when it already carries a user-facing message. Raw
 * transport errors (a `TypeError` from a refused connection) have none, and
 * letting them reach the RPC boundary surfaces as an opaque "background request
 * failed". Wrap them in a provider error that names what went wrong and where.
 */
const presentableDiscoveryError = (
  error: unknown,
  config?: ProviderConfig
): Error => {
  if (isAppError(error)) return error
  const baseUrl = resolveProviderBaseUrlSafe(config)
  const rawMessage = error instanceof Error ? error.message : String(error)
  return createAppError(
    `Could not reach the provider at ${baseUrl ?? "the configured base URL"}`,
    {
      kind: "provider",
      code: "OLC-PROVIDER-UNREACHABLE",
      recoveryAction: "test-connection",
      retryable: true,
      userMessage: `Nothing answered at ${
        baseUrl ?? "the configured base URL"
      }. The local service may not be running, or the base URL does not match
where it listens. Check that your LLM server is up and points to this address.`,
      providerId: config?.id,
      baseUrl,
      debug: rawMessage,
      cause: error
    }
  )
}

const resolveProviderBaseUrlSafe = (
  config?: ProviderConfig
): string | undefined => {
  if (!config) return undefined
  try {
    return resolveProviderBaseUrl(config)
  } catch {
    return undefined
  }
}

/**
 * The one production path that asks a provider for its catalog.
 *
 * Every caller that wants a model list goes through here — RPC model listing,
 * connection tests, background health checks, tool capability resolution,
 * embedding model checks — because the policy is not something a caller can
 * usefully reimplement. It has three parts, and each one was got wrong at least
 * once by a caller that reached for `provider.getModels` directly:
 *
 * 1. **A remembered absence is honoured.** A gateway that implements only
 *    `/chat/completions` answers 404 forever; asking it again on every tool
 *    resolution spends someone's rate limit on an answer that will not change.
 * 2. **Absence and failure stay distinct.** Only 404/405/501 is recorded as
 *    "no catalog here". A 401, a 429, a 5xx or no answer at all says nothing
 *    about whether the endpoint exists, so none of them is remembered.
 * 3. **A failure is returned, not thrown.** Whether a missing catalog is fatal
 *    depends on the caller — it is normal for the model menu and disqualifying
 *    for a connection test — so the verdict travels with the result.
 *
 * `force` bypasses only the remembered answer, never the recording: an explicit
 * connection test re-probes and updates what is stored. `record: false` is for
 * an RPC query, which must not persist anything: it still honours what is
 * remembered, and learns nothing.
 */
export const discoverModels = async (
  config: ProviderConfig | undefined,
  resolveProvider: () => Promise<Pick<LLMProvider, "getModels">>,
  signal?: AbortSignal,
  options: { force?: boolean; record?: boolean } = {}
): Promise<ModelDiscoveryResult> => {
  const remember = (supported: boolean) =>
    config && config.type !== "browser" && options.record !== false
      ? recordModelCatalogSupport(config, supported)
      : Promise.resolve()
  if (
    config &&
    config.type !== "browser" &&
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
      return {
        models: [],
        catalog: "failed",
        error: presentableDiscoveryError(error, config)
      }
    }
    await remember(false).catch(() => undefined)
    return { models: [], catalog: "absent" }
  }
}

/**
 * Discover against an already-resolved provider.
 *
 * The common shape for callers holding a live `LLMProvider`: the config it
 * carries is what the remembered answer is keyed on, so passing it separately
 * would only create a way to key the answer to the wrong endpoint.
 */
export const discoverProviderModels = (
  provider: LLMProvider,
  signal?: AbortSignal,
  options: { force?: boolean; record?: boolean } = {}
): Promise<ModelDiscoveryResult> =>
  discoverModels(provider.config, async () => provider, signal, options)

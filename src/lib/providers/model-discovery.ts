import { isAppError } from "@/lib/error-utils"
import type { ProviderModel } from "@/types/model"
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
 * connection test re-probes and updates what is stored.
 */
export const discoverModels = async (
  config: ProviderConfig | undefined,
  resolveProvider: () => Promise<Pick<LLMProvider, "getModels">>,
  signal?: AbortSignal,
  options: { force?: boolean } = {}
): Promise<ModelDiscoveryResult> => {
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
  options: { force?: boolean } = {}
): Promise<ModelDiscoveryResult> =>
  discoverModels(provider.config, async () => provider, signal, options)

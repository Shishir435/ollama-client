import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { withStorageWriteLock } from "@/lib/storage/storage-write-lock"
import { resolveProviderBaseUrl } from "./base-url"
import type { ProviderConfig } from "./types"

/**
 * Whether a provider publishes a model catalog, learned once and remembered.
 *
 * Discovery asks every enabled provider for its model list — on every refresh,
 * and once per background health check. A hosted gateway that implements
 * `/chat/completions` and nothing else answers all of those with 404, so a
 * perfectly working provider produced a steady drip of failed requests against
 * someone else's rate limit for an answer that was never going to change.
 *
 * So the answer is stored. A provider known not to publish a catalog is not
 * asked again: its models come from the ids the user declared. The marker is:
 *
 * - **device-local** — the base URL points at a different server per device;
 * - **fingerprinted** — a change of wire, base URL, or service profile makes
 *   the stored answer describe a different endpoint, so it stops applying;
 * - **expiring** — a server can gain the endpoint in an upgrade, so a negative
 *   answer is re-checked after a day. An explicit connection test always
 *   re-probes, whatever the marker says.
 *
 * Only "the endpoint is not there" (404/405/501) is recorded as absent. A
 * refused key, a rate limit, or a server error says nothing about whether the
 * catalog exists, so those leave the marker alone.
 */
export interface ModelCatalogSupportEntry {
  supported: boolean
  /** Fingerprint of the config this answer describes. */
  signature: string
  checkedAt: number
}

export type ModelCatalogSupportMap = Record<string, ModelCatalogSupportEntry>

const STORAGE_KEY = STORAGE_KEYS.PROVIDER.MODEL_CATALOG_SUPPORT
const WRITE_LOCK = "model-catalog-support-write"

/** How long a "no catalog here" answer is trusted before it is re-checked. */
export const CATALOG_SUPPORT_TTL_MS = 24 * 60 * 60 * 1000

/** Statuses that mean the catalog endpoint is not implemented at all. */
export const CATALOG_ABSENT_STATUSES = [404, 405, 501] as const

export const isCatalogAbsentStatus = (status: number | undefined): boolean =>
  status !== undefined &&
  (CATALOG_ABSENT_STATUSES as readonly number[]).includes(status)

/**
 * What the stored answer is about. The API key is deliberately absent: a
 * changed credential cannot add or remove an endpoint, and 401 is never
 * recorded in the first place.
 */
export const catalogSignature = (config: ProviderConfig): string =>
  [
    String(config.type),
    resolveProviderBaseUrl(config),
    config.serviceProfile ?? ""
  ].join("|")

export const getModelCatalogSupportMap =
  async (): Promise<ModelCatalogSupportMap> =>
    (await getPlasmoStoredValue<ModelCatalogSupportMap>(STORAGE_KEY)) ?? {}

/**
 * The remembered answer for this exact config, or `null` when there is none,
 * it describes a different endpoint, or it has expired.
 */
export const getModelCatalogSupport = async (
  config: ProviderConfig,
  now = Date.now()
): Promise<boolean | null> => {
  const entry = (await getModelCatalogSupportMap())[String(config.id)]
  if (!entry) return null
  if (entry.signature !== catalogSignature(config)) return null
  if (now - entry.checkedAt > CATALOG_SUPPORT_TTL_MS) return null
  return entry.supported
}

/** True when discovery should not spend a request on this provider. */
export const shouldSkipModelCatalog = async (
  config: ProviderConfig,
  now = Date.now()
): Promise<boolean> => (await getModelCatalogSupport(config, now)) === false

export const recordModelCatalogSupport = (
  config: ProviderConfig,
  supported: boolean,
  now = Date.now()
): Promise<void> =>
  withStorageWriteLock(WRITE_LOCK, async () => {
    const all = await getModelCatalogSupportMap()
    all[String(config.id)] = {
      supported,
      signature: catalogSignature(config),
      checkedAt: now
    }
    await setPlasmoStoredValue(STORAGE_KEY, all)
  })

export const clearModelCatalogSupport = (providerId: string): Promise<void> =>
  withStorageWriteLock(WRITE_LOCK, async () => {
    const all = await getModelCatalogSupportMap()
    if (!(providerId in all)) return
    delete all[providerId]
    await setPlasmoStoredValue(STORAGE_KEY, all)
  })

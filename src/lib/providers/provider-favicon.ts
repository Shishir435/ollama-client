import { STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { withStorageWriteLock } from "@/lib/storage/storage-write-lock"
import { resolveProviderBaseUrl } from "./base-url"
import type { ProviderConfig } from "./types"

/**
 * The icon of last resort: a remote provider we have no curated mark for gets
 * the favicon its own endpoint serves.
 *
 * The base URL the user configured is asked first, and it is the only host
 * asked when it has an icon: that request goes somewhere they already send
 * inference, so it reveals nothing their traffic does not.
 *
 * Most vendor API hosts are API surfaces rather than websites, and answer 404 —
 * or, when the gateway guards every path behind its key, 401. Those are settled
 * answers, so the vendor's own site is asked once instead. A third-party favicon
 * service is never used: it would hand every configured provider URL to whoever
 * runs it, which is the opposite of what this is for.
 */
export interface ProviderFaviconEntry {
  /** `data:` URI, or null when the host has no usable favicon. */
  dataUrl: string | null
  /** Base URL this answer describes. */
  signature: string
  fetchedAt: number
}

export type ProviderFaviconMap = Record<string, ProviderFaviconEntry>

const CACHE_KEY = STORAGE_KEYS.PROVIDER.FAVICON_CACHE
const LOOKUP_KEY = STORAGE_KEYS.PROVIDER.FAVICON_LOOKUP
const WRITE_LOCK = "provider-favicon-write"

/** A favicon that was found rarely changes; a miss is worth retrying sooner. */
export const FAVICON_FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const FAVICON_MISSING_TTL_MS = 3 * 24 * 60 * 60 * 1000

/**
 * Icons are rendered at 16-20px, so anything larger is a site trying to serve a
 * full-size logo. The cap also bounds what a hostile endpoint can push into
 * device storage.
 */
export const FAVICON_MAX_BYTES = 32 * 1024

const FETCH_TIMEOUT_MS = 4_000

/**
 * Raster formats only, sniffed from the leading bytes rather than trusted from
 * `Content-Type`: a misconfigured server answering 200 with an HTML error page
 * is common enough that the header alone is not evidence. SVG is excluded
 * because it has no fixed signature to sniff and carries far more markup than
 * an icon slot needs.
 */
const IMAGE_SIGNATURES: ReadonlyArray<readonly [string, number[]]> = [
  ["image/x-icon", [0x00, 0x00, 0x01, 0x00]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["image/webp", [0x52, 0x49, 0x46, 0x46]]
]

const sniffImageType = (bytes: Uint8Array): string | undefined =>
  IMAGE_SIGNATURES.find(([, magic]) =>
    magic.every((byte, index) => bytes[index] === byte)
  )?.[0]

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/,
  /\.local$/,
  /\.localhost$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^\[?fe80:/i
]

const hostnameOf = (baseUrl?: string): string | undefined => {
  const raw = baseUrl?.trim()
  if (!raw) return undefined
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * Whether a base URL points somewhere worth asking. A LAN inference server has
 * no favicon to serve, so probing it spends a request on a certain miss, and a
 * bare hostname with no dot is a local machine name.
 */
export const isRemoteFaviconHost = (baseUrl?: string): boolean => {
  const host = hostnameOf(baseUrl)
  if (!host) return false
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) return false
  return host.includes(".")
}

const faviconUrl = (baseUrl: string): string | undefined => {
  try {
    return new URL("/favicon.ico", baseUrl).toString()
  } catch {
    return undefined
  }
}

/**
 * Multi-label public suffixes common enough to matter. Stripping one label off
 * `api.example.co.uk` gives the site; stripping one off `example.co.uk` gives a
 * registry, which belongs to nobody and must never be contacted. Shipping the
 * full Public Suffix List for one icon is not worth its size, so this covers
 * the shapes that actually appear and the guard refuses anything it is unsure
 * of.
 */
const PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.jp",
  "or.jp",
  "ne.jp",
  "com.au",
  "net.au",
  "org.au",
  "com.br",
  "com.cn",
  "net.cn",
  "org.cn",
  "com.hk",
  "co.in",
  "co.kr",
  "co.nz",
  "com.mx",
  "com.sg",
  "com.tr",
  "com.tw",
  "co.za"
])

/**
 * The site one level above an API host: `api.acme-router.example` →
 * `acme-router.example`. Exactly one label is stripped — a vendor's icon lives on
 * its own site, not somewhere further up — and the result must still be a real
 * site rather than a registry suffix.
 */
export const parentDomainOf = (host: string): string | undefined => {
  const labels = host.split(".")
  if (labels.length < 3) return undefined
  const parent = labels.slice(1).join(".")
  if (parent.split(".").length < 2) return undefined
  if (PUBLIC_SUFFIXES.has(parent)) return undefined
  return parent
}

const parentFaviconUrl = (baseUrl: string): string | undefined => {
  try {
    const url = new URL(baseUrl)
    const parent = parentDomainOf(url.hostname.toLowerCase())
    if (!parent) return undefined
    // No port: the parent is a website, not the inference service that happened
    // to be running on one.
    return `${url.protocol}//${parent}/favicon.ico`
  } catch {
    return undefined
  }
}

const toDataUrl = (bytes: Uint8Array, mimeType: string): string => {
  let binary = ""
  const CHUNK = 0x8000
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

export const isFaviconLookupEnabled = async (): Promise<boolean> =>
  (await getPlasmoStoredValue<boolean>(LOOKUP_KEY)) !== false

export const setFaviconLookupEnabled = (enabled: boolean): Promise<void> =>
  setPlasmoStoredValue(LOOKUP_KEY, enabled)

export const getProviderFaviconMap = async (): Promise<ProviderFaviconMap> =>
  (await getPlasmoStoredValue<ProviderFaviconMap>(CACHE_KEY)) ?? {}

const isFresh = (entry: ProviderFaviconEntry, now: number): boolean => {
  const ttl = entry.dataUrl ? FAVICON_FOUND_TTL_MS : FAVICON_MISSING_TTL_MS
  return now - entry.fetchedAt <= ttl
}

/**
 * The remembered icon for this exact base URL, or `null` when there is none,
 * it describes a different endpoint, or it has aged out.
 */
export const getCachedProviderFavicon = async (
  config: ProviderConfig,
  now = Date.now()
): Promise<ProviderFaviconEntry | null> => {
  const entry = (await getProviderFaviconMap())[String(config.id)]
  if (!entry) return null
  if (entry.signature !== resolveProviderBaseUrl(config)) return null
  if (!isFresh(entry, now)) return null
  return entry
}

const recordProviderFavicon = (
  config: ProviderConfig,
  dataUrl: string | null,
  now = Date.now()
): Promise<void> =>
  withStorageWriteLock(WRITE_LOCK, async () => {
    const all = await getProviderFaviconMap()
    all[String(config.id)] = {
      dataUrl,
      signature: resolveProviderBaseUrl(config),
      fetchedAt: now
    }
    await setPlasmoStoredValue(CACHE_KEY, all)
  })

export const clearProviderFavicon = (providerId: string): Promise<void> =>
  withStorageWriteLock(WRITE_LOCK, async () => {
    const all = await getProviderFaviconMap()
    if (!(providerId in all)) return
    delete all[providerId]
    await setPlasmoStoredValue(CACHE_KEY, all)
  })

export const clearAllProviderFavicons = (): Promise<void> =>
  withStorageWriteLock(WRITE_LOCK, () => setPlasmoStoredValue(CACHE_KEY, {}))

/**
 * Statuses that mean "this host has nothing for us", as opposed to "this host
 * is broken right now". An API gateway guarding every path behind its key
 * answers 401 to `/favicon.ico` as readily as 404 — both are settled answers,
 * and both are worth one look at the vendor's own site. A 5xx or a rate limit
 * says nothing, so neither is chased.
 */
const NO_ICON_STATUSES = [401, 403, 404, 410]

interface IconAttempt {
  dataUrl: string | null
  /** The host answered, and there is no usable icon at that address. */
  absent: boolean
}

const NETWORK_FAILURE: IconAttempt = { dataUrl: null, absent: false }
const NO_ICON: IconAttempt = { dataUrl: null, absent: true }

const fetchIcon = async (
  url: string,
  signal?: AbortSignal
): Promise<IconAttempt> => {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS)
  const onAbort = () => timeout.abort()
  signal?.addEventListener("abort", onAbort, { once: true })

  try {
    const response = await fetch(url, {
      signal: timeout.signal,
      credentials: "omit",
      redirect: "follow"
    })
    if (!response.ok) {
      return NO_ICON_STATUSES.includes(response.status)
        ? NO_ICON
        : NETWORK_FAILURE
    }

    const declared = Number(response.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > FAVICON_MAX_BYTES)
      return NO_ICON

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > FAVICON_MAX_BYTES) {
      return NO_ICON
    }

    // A 200 carrying an HTML error page is a settled "not here" too — a
    // single-page app serving its shell at every path answers exactly this way.
    const mimeType = sniffImageType(bytes)
    if (!mimeType) return NO_ICON

    return { dataUrl: toDataUrl(bytes, mimeType), absent: false }
  } catch {
    return NETWORK_FAILURE
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

/**
 * Fetch the favicon once and remember the answer, including a miss. Errors are
 * swallowed into a null entry: an icon is decoration, and a provider whose site
 * is down or whose endpoint refuses the request is still a working provider.
 *
 * The configured host is asked first, always. Its parent site is asked only
 * when that host gave a settled answer of "nothing here" — never after a
 * timeout or a server error, where a second host is just a second thing to go
 * wrong.
 */
const fetchProviderFavicon = async (
  config: ProviderConfig,
  signal?: AbortSignal
): Promise<string | null> => {
  const baseUrl = resolveProviderBaseUrl(config)
  const url = faviconUrl(baseUrl)
  if (!url) return null

  const direct = await fetchIcon(url, signal)
  if (direct.dataUrl || !direct.absent) return direct.dataUrl

  const parent = parentFaviconUrl(baseUrl)
  if (!parent) return null

  logger.debug(
    "Falling back to the parent site for a provider icon",
    "ProviderFavicon",
    { providerId: String(config.id) }
  )
  return (await fetchIcon(parent, signal)).dataUrl
}

/**
 * Cached icon for a provider, fetching once if the cache has nothing fresh.
 * Returns null whenever lookup is disabled, the host is local, or the endpoint
 * has no usable icon — every one of which is a normal outcome.
 */
export const resolveProviderFavicon = async (
  config: ProviderConfig,
  signal?: AbortSignal,
  now = Date.now()
): Promise<string | null> => {
  const baseUrl = resolveProviderBaseUrl(config)
  if (!isRemoteFaviconHost(baseUrl)) return null
  if (!(await isFaviconLookupEnabled())) return null

  const cached = await getCachedProviderFavicon(config, now)
  if (cached) return cached.dataUrl

  const dataUrl = await fetchProviderFavicon(config, signal)
  await recordProviderFavicon(config, dataUrl, now).catch(() => undefined)
  return dataUrl
}

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
 *
 * Every address reached is one this module chose and vetted. Redirects are
 * refused rather than followed, because a followed one is chosen by the
 * provider — and this request carries `<all_urls>` host permission.
 *
 * **What the host filter cannot do.** It reads hostnames, so a public name that
 * resolves to a private address still passes. Nothing in an extension closes
 * that: `chrome.dns` is dev-channel only and cannot ship, and resolving before
 * fetching would not help anyway — `fetch` performs its own lookup, so the
 * check and the request can be answered differently, which is the whole trick.
 *
 * What bounds it instead is that the response goes nowhere. It is stored
 * device-local and drawn, never returned to the provider, so there is no
 * channel to read an internal service through. `credentials: "omit"` means
 * nothing authenticates, the byte sniff means a JSON metadata reply is
 * discarded rather than cached, and reaching any of it at all requires a
 * provider the user configured, enabled, and is already sending prompts to.
 * What remains is one blind, unauthenticated GET, which is the cost of the
 * feature and the reason it can be switched off.
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

const PRIVATE_HOST_SUFFIXES = [
  /^localhost$/,
  /\.local$/,
  /\.localhost$/,
  /\.internal$/,
  /\.home\.arpa$/
]

/**
 * Address blocks this must never reach, as `[first, last]` pairs.
 *
 * Written as ranges rather than string prefixes because the prefixes were
 * wrong in both directions: `169.254.0.0/16` was missing entirely — and with it
 * `169.254.169.254`, the cloud metadata endpoint — while a check like `^10\.`
 * says nothing about `100.64.0.0/10` next door. A number either falls in a
 * block or it does not.
 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT, and what Tailscale hands out
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4] // reserved, and 255.255.255.255 with it
]

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/**
 * The address as a number, or undefined when the host is a name rather than a
 * dotted quad. Shorthand and numeric forms — `127.1`, `0x7f.1`, `2130706433` —
 * never arrive here: the URL parser normalizes them to dotted quads first.
 */
const ipv4ToNumber = (host: string): number | undefined => {
  const match = IPV4.exec(host)
  if (!match) return undefined
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return undefined
  return octets.reduce((total, octet) => total * 256 + octet, 0)
}

const isBlockedIpv4 = (host: string): boolean => {
  const address = ipv4ToNumber(host)
  if (address === undefined) return false
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const start = ipv4ToNumber(base)
    if (start === undefined) return false
    const size = 2 ** (32 - bits)
    return address >= start && address < start + size
  })
}

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
 * Whether a base URL points somewhere worth asking — and, more importantly,
 * somewhere this is allowed to ask. A LAN inference server has no favicon to
 * serve, so probing it spends a request on a certain miss; a link-local or
 * loopback address has something far worse than a miss to offer a request
 * carrying `<all_urls>`.
 *
 * The requirement of a dot is doing real work: it rejects single-label intranet
 * names, and every IPv6 literal with them, since the URL parser keeps those
 * bracketed.
 */
export const isRemoteFaviconHost = (baseUrl?: string): boolean => {
  const host = hostnameOf(baseUrl)
  if (!host) return false
  if (PRIVATE_HOST_SUFFIXES.some((pattern) => pattern.test(host))) return false
  if (isBlockedIpv4(host)) return false
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
    /*
     * Redirects are refused, not followed. `isRemoteFaviconHost` vets the host
     * we chose; a 302 lets the provider choose the next one, and this request
     * carries `<all_urls>` host permission — so a public endpoint could point
     * it at loopback or a LAN address and have the extension fetch what the
     * page never could. `manual` returns an opaque redirect instead of
     * following, which is also the only way to notice one: the filtered
     * response exposes no `Location` to re-validate.
     */
    const response = await fetch(url, {
      signal: timeout.signal,
      credentials: "omit",
      redirect: "manual"
    })

    // Treated as absent rather than as a failure, so the parent site still
    // gets its turn — an API host redirecting /favicon.ico has none of its own.
    if (response.type === "opaqueredirect" || response.status === 0) {
      return NO_ICON
    }

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

  /*
   * Unreachable today, and kept anyway. A parent inherits its base's suffixes,
   * and it cannot be a private literal because a host whose last label is
   * numeric but is not a valid quad — `sub.127.0.0.1` — fails to parse at all.
   * Both of those live in the URL parser and the suffix list rather than here,
   * so the guard states the invariant locally: every address this module
   * fetches has passed the filter, without a reader having to rebuild that
   * argument to be sure.
   */
  if (!isRemoteFaviconHost(parent)) return null

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

  /*
   * Nothing is written once the caller has gone. An aborted fetch comes back
   * indistinguishable from an endpoint with no icon, so recording it would
   * remember a three-day miss for a request that was merely cancelled, and the
   * provider would sit iconless until that entry aged out.
   */
  if (signal?.aborted) return dataUrl

  await recordProviderFavicon(config, dataUrl, now).catch(() => undefined)
  return dataUrl
}

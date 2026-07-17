import { LEGACY_STORAGE_KEYS } from "@/lib/constants/keys"
import { ProviderStorageKey } from "@/lib/providers/types"
import { STORAGE_KEY_REGISTRY } from "@/lib/storage/storage-key-registry"

export const BACKUP_MANIFEST_VERSION = 2
export const SUPPORTED_BACKUP_MANIFEST_VERSIONS = new Set([1, 2])

const flattenStringValues = (value: unknown): string[] => {
  if (typeof value === "string") return [value]
  if (!value || typeof value !== "object") return []
  return Object.values(value).flatMap(flattenStringValues)
}

const PORTABLE_STORAGE_KEYS = new Set([
  ...Object.values(STORAGE_KEY_REGISTRY)
    .filter(({ scope }) => scope === "sync-safe")
    .map(({ key }) => key),
  ProviderStorageKey.CONFIG,
  ProviderStorageKey.MODEL_MAPPINGS_V2
])

const LEGACY_PORTABLE_STORAGE_KEYS = new Set([
  ...flattenStringValues(LEGACY_STORAGE_KEYS),
  ProviderStorageKey.MODEL_MAPPINGS
])

const SENSITIVE_PROPERTY_NAMES = new Set([
  "accesstoken",
  "apikey",
  "authtoken",
  "authorization",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "customheaders",
  "headers",
  "password",
  "privatekey",
  "proxyauthorization",
  "refreshtoken",
  "secret",
  "secretkey",
  "setcookie",
  "token",
  "xapikey"
])

const normalizePropertyName = (key: string): string =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "")

const sanitizeUrlCredentials = (value: string): string => {
  try {
    const url = new URL(value)
    if (!url.username && !url.password) return value
    url.username = ""
    url.password = ""
    return url.toString()
  } catch {
    return value
  }
}

const sanitizePortableValue = (value: unknown): unknown => {
  if (Array.isArray(value))
    return value.map((item) => sanitizePortableValue(item))
  if (!value || typeof value !== "object") return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_PROPERTY_NAMES.has(normalizePropertyName(key))) continue
    const normalizedKey = normalizePropertyName(key)
    sanitized[key] =
      typeof nestedValue === "string" && normalizedKey.endsWith("url")
        ? sanitizeUrlCredentials(nestedValue)
        : sanitizePortableValue(nestedValue)
  }
  return sanitized
}

export const selectPortableStorageData = (
  storageData: Record<string, unknown>,
  options: { allowLegacyKeys?: boolean } = {}
): { data: Record<string, unknown>; rejectedKeys: string[] } => {
  const data: Record<string, unknown> = {}
  const rejectedKeys: string[] = []

  for (const [key, value] of Object.entries(storageData)) {
    const allowed =
      PORTABLE_STORAGE_KEYS.has(key) ||
      (options.allowLegacyKeys === true &&
        LEGACY_PORTABLE_STORAGE_KEYS.has(key))
    if (!allowed) {
      rejectedKeys.push(key)
      continue
    }
    data[key] = sanitizePortableValue(value)
  }

  return { data, rejectedKeys }
}

export const getPortableStorageKeys = (): string[] => [...PORTABLE_STORAGE_KEYS]

export const getImportResetStorageKeys = (): string[] =>
  [
    ...new Set([...getPortableStorageKeys(), ...LEGACY_PORTABLE_STORAGE_KEYS])
  ].filter((key) => key !== ProviderStorageKey.CONFIG)

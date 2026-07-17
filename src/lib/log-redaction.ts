export const REDACTED_LOG_VALUE = "[REDACTED]"
const CIRCULAR_LOG_VALUE = "[Circular]"
const UNREADABLE_LOG_VALUE = "[Unreadable]"

const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[^a-z0-9]/g, "")

const SECRET_KEYS = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "auth",
  "authtoken",
  "authorization",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credentials",
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

const PRIVATE_CONTENT_KEYS = new Set([
  "body",
  "content",
  "delta",
  "document",
  "filecontent",
  "input",
  "messages",
  "output",
  "pagecontent",
  "prompt",
  "prompts",
  "query",
  "reasoning",
  "requestbody",
  "responsebody",
  "systemprompt",
  "text",
  "thinking",
  "transcript"
])

const PRIVATE_CONTAINER_KEYS = new Set(["customheaders", "headers"])

const SENSITIVE_TEXT_KEY_PATTERN =
  "(?:api[-_ ]?key|access[-_ ]?token|auth(?:orization)?|bearer[-_ ]?token|client[-_ ]?secret|cookie|credential|password|private[-_ ]?key|proxy[-_ ]?authorization|refresh[-_ ]?token|secret(?:[-_ ]?key)?|token|x[-_ ]?api[-_ ]?key)"

const QUOTED_SECRET_PATTERN = new RegExp(
  `(["']?${SENSITIVE_TEXT_KEY_PATTERN}["']?\\s*[:=]\\s*)(["'])((?:\\\\[\\s\\S]|(?!\\2)[\\s\\S])*)\\2`,
  "gi"
)

const UNQUOTED_SECRET_PATTERN = new RegExp(
  `(["']?${SENSITIVE_TEXT_KEY_PATTERN}["']?\\s*[:=]\\s*)([^\\s,"'}]+)`,
  "gi"
)

const isSecretKey = (key: string): boolean => {
  const normalized = normalizeKey(key)
  return (
    SECRET_KEYS.has(normalized) ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token")
  )
}

const isPrivateContentKey = (key: string): boolean =>
  PRIVATE_CONTENT_KEYS.has(normalizeKey(key))

const isPrivateContainerKey = (key: string): boolean =>
  PRIVATE_CONTAINER_KEYS.has(normalizeKey(key))

const redactUrl = (value: string): string => {
  if (!/^https?:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      url.username = ""
      url.password = ""
    }
    for (const key of url.searchParams.keys()) {
      if (isSecretKey(key)) url.searchParams.set(key, REDACTED_LOG_VALUE)
    }
    return url.toString()
  } catch {
    return value
  }
}

/** Redact credentials that can appear outside a structured object. */
export const redactLogText = (value: string): string => {
  const urlRedacted = redactUrl(value)
  return urlRedacted
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${REDACTED_LOG_VALUE}`)
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, REDACTED_LOG_VALUE)
    .replace(QUOTED_SECRET_PATTERN, `$1$2${REDACTED_LOG_VALUE}$2`)
    .replace(UNQUOTED_SECRET_PATTERN, `$1${REDACTED_LOG_VALUE}`)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1")
}

const redactLogStringValue = (
  value: string,
  seen: WeakSet<object>
): unknown => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return redactLogValue(JSON.parse(trimmed), seen)
    } catch {
      // Not valid JSON; apply ordinary text redaction below.
    }
  }
  return redactLogText(value)
}

const redactPrivateContainer = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return REDACTED_LOG_VALUE
  }

  try {
    return Object.fromEntries(
      Object.keys(value).map((key) => [key, REDACTED_LOG_VALUE])
    )
  } catch {
    return REDACTED_LOG_VALUE
  }
}

const redactError = (error: Error, seen: WeakSet<object>): unknown => {
  const result: Record<string, unknown> = {
    name: redactLogText(error.name),
    message: redactLogText(error.message)
  }
  if (error.stack) result.stack = redactLogText(error.stack)
  if (error.cause !== undefined)
    result.cause = redactLogValue(error.cause, seen)

  for (const key of Object.keys(error)) {
    if (key in result) continue
    result[key] = redactProperty(key, error[key as keyof Error], seen)
  }
  return result
}

const redactProperty = (
  key: string,
  value: unknown,
  seen: WeakSet<object>
): unknown => {
  if (isSecretKey(key) || isPrivateContentKey(key)) return REDACTED_LOG_VALUE
  if (isPrivateContainerKey(key)) return redactPrivateContainer(value)
  return redactLogValue(value, seen)
}

/**
 * Create a privacy-safe, eager snapshot for a console or diagnostic sink.
 * The input is never mutated and object references are never forwarded.
 */
export const redactLogValue = (
  value: unknown,
  seen = new WeakSet<object>()
): unknown => {
  if (typeof value === "string") return redactLogStringValue(value, seen)
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value
  }
  if (typeof value === "symbol") return value.toString()
  if (typeof value === "function")
    return `[Function ${value.name || "anonymous"}]`

  if (seen.has(value)) return CIRCULAR_LOG_VALUE
  seen.add(value)

  if (value instanceof Error) return redactError(value, seen)
  if (value instanceof Date)
    return Number.isNaN(value.getTime())
      ? UNREADABLE_LOG_VALUE
      : value.toISOString()
  if (value instanceof URL) return redactLogText(value.toString())
  if (Array.isArray(value))
    return value.map((item) => redactLogValue(item, seen))

  try {
    const result: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = redactProperty(key, nestedValue, seen)
    }
    return result
  } catch {
    return UNREADABLE_LOG_VALUE
  }
}

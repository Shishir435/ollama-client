import { STORAGE_KEYS } from "@/lib/constants"
import {
  getPlasmoStoredValue,
  removePlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { withStorageWriteLock } from "@/lib/storage/storage-write-lock"
import {
  type DiagnosticEvent,
  DiagnosticEventSchema
} from "@/protocol/diagnostics-rpc"

const MAX_EVENTS = 200
const MAX_SERIALIZED_CHARS = 128 * 1024
const MAX_PENDING_EVENTS = 50
const MAX_PENDING_SERIALIZED_CHARS = 32 * 1024
const EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FLUSH_DELAY_MS = 15_000
const DIAGNOSTIC_LOCK = "diagnostic-events-v1-write"
const PENDING_STORAGE_KEY = "diagnostic-pending-events-v1"
const SAFE_METADATA_KEYS = new Set([
  "browserApi",
  "capability",
  "count",
  "errorCode",
  "phase",
  "result",
  "schemaVersion",
  "source",
  "status"
])

type DiagnosticInput = Omit<DiagnosticEvent, "id" | "at" | "metadata"> & {
  metadata?: Record<string, unknown>
}

let fallbackPendingEvents: DiagnosticEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | undefined

type SessionStorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
  remove: (key: string) => Promise<void>
}

const getSessionStorage = (): SessionStorageArea | undefined =>
  (
    chrome.storage as typeof chrome.storage & {
      session?: SessionStorageArea
    }
  ).session

const safeMetadata = (
  metadata: Record<string, unknown> | undefined
): DiagnosticEvent["metadata"] => {
  if (!metadata) return undefined
  const entries = Object.entries(metadata).flatMap(([key, value]) => {
    if (!SAFE_METADATA_KEYS.has(key)) return []
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      return []
    }
    if (typeof value === "string" && !/^[a-zA-Z0-9_.:-]{1,100}$/.test(value)) {
      return []
    }
    return [[key, value] as const]
  })
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

const compactEvents = (
  events: DiagnosticEvent[],
  now: number,
  maxEvents = MAX_EVENTS,
  maxSerializedChars = MAX_SERIALIZED_CHARS
) => {
  const compacted = Array.from(
    new Map(
      events
        .filter((event) => now - event.at <= EVENT_TTL_MS)
        .map((event) => [event.id, event])
    ).values()
  ).slice(-maxEvents)
  while (
    compacted.length > 0 &&
    JSON.stringify(compacted).length > maxSerializedChars
  ) {
    compacted.shift()
  }
  return compacted
}

const readStoredEvents = async (): Promise<DiagnosticEvent[]> => {
  const raw = await getPlasmoStoredValue<unknown>(
    STORAGE_KEYS.DIAGNOSTICS.EVENTS
  )
  if (!Array.isArray(raw)) return []
  return raw.flatMap((event) => {
    const parsed = DiagnosticEventSchema.safeParse(event)
    return parsed.success ? [parsed.data] : []
  })
}

const parseEvents = (raw: unknown): DiagnosticEvent[] => {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((event) => {
    const parsed = DiagnosticEventSchema.safeParse(event)
    return parsed.success ? [parsed.data] : []
  })
}

const readPendingEvents = async (): Promise<DiagnosticEvent[]> => {
  const sessionStorage = getSessionStorage()
  if (!sessionStorage) return fallbackPendingEvents
  const stored = await sessionStorage.get(PENDING_STORAGE_KEY)
  return parseEvents(stored[PENDING_STORAGE_KEY])
}

const writePendingEvents = async (events: DiagnosticEvent[]): Promise<void> => {
  const sessionStorage = getSessionStorage()
  if (!sessionStorage) {
    fallbackPendingEvents = events
    return
  }
  await sessionStorage.set({ [PENDING_STORAGE_KEY]: events })
}

const clearPendingEvents = async (): Promise<void> => {
  fallbackPendingEvents = []
  await getSessionStorage()?.remove(PENDING_STORAGE_KEY)
}

export const getDiagnosticEvents = async (
  now = Date.now()
): Promise<DiagnosticEvent[]> =>
  withStorageWriteLock(DIAGNOSTIC_LOCK, async () =>
    compactEvents(
      [...(await readStoredEvents()), ...(await readPendingEvents())],
      now
    )
  )

export const flushDiagnosticEvents = async (): Promise<void> => {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = undefined
  }
  await withStorageWriteLock(DIAGNOSTIC_LOCK, async () => {
    const batch = await readPendingEvents()
    if (batch.length === 0) return
    try {
      const stored = await readStoredEvents()
      await setPlasmoStoredValue(
        STORAGE_KEYS.DIAGNOSTICS.EVENTS,
        compactEvents([...stored, ...batch], Date.now())
      )
      await clearPendingEvents()
    } catch (error) {
      await writePendingEvents(batch)
      throw error
    }
  })
}

const scheduleFlush = () => {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    void flushDiagnosticEvents().catch(() => undefined)
  }, FLUSH_DELAY_MS)
}

export const recordDiagnosticEvent = async (
  input: DiagnosticInput
): Promise<void> => {
  const event = DiagnosticEventSchema.parse({
    ...input,
    id: crypto.randomUUID(),
    at: Date.now(),
    metadata: safeMetadata(input.metadata)
  })
  await withStorageWriteLock(DIAGNOSTIC_LOCK, async () => {
    const pendingEvents = await readPendingEvents()
    await writePendingEvents(
      compactEvents(
        [...pendingEvents, event],
        event.at,
        MAX_PENDING_EVENTS,
        MAX_PENDING_SERIALIZED_CHARS
      )
    )
  })
  scheduleFlush()
}

export const clearDiagnosticEvents = async (): Promise<void> => {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = undefined
  }
  await withStorageWriteLock(DIAGNOSTIC_LOCK, async () => {
    await clearPendingEvents()
    await removePlasmoStoredValue(STORAGE_KEYS.DIAGNOSTICS.EVENTS)
  })
}

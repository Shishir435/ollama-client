import type { Database, SqlJsStatic } from "sql.js"
import { SCHEMA_SQL } from "../schema"

// Shared fixture + measurement protocol for the section 9.8 persistence
// benchmarks. Runs unchanged in Node (tools/benchmark-sqlite-persistence.ts
// with fake-indexeddb) and in packaged browsers (src/entrypoints/benchmark/).
// Uses benchmark-only IndexedDB names; never opens the live chat database.

export type ScaleName = "small" | "medium" | "large" | "binary" | "tree"

export interface AttachmentPlan {
  count: number
  imageBytes: number
  pdfBytes: number
  everyNthChat: number
}

export interface TreePlan {
  trunkDepth: number
  branchRoots: number[]
  branchDepth: number
  wideAt: number
  wideChildren: number
}

export interface Scale {
  chats: number
  messages: number
  attachments?: AttachmentPlan
  tree?: TreePlan
}

export interface SampleSummary {
  p50: number
  p95: number
}

export interface BenchmarkEnvironment {
  indexedDB: IDBFactory
  // Returns current memory usage in bytes, or null when the platform does
  // not expose one (process RSS in Node, performance.memory in Chromium).
  sampleMemoryBytes: () => number | null
  memoryMetric: string | null
}

export const TREE_PLAN: TreePlan = {
  trunkDepth: 40,
  branchRoots: [10, 20, 30],
  branchDepth: 10,
  wideAt: 5,
  wideChildren: 12
}

export const messagesPerTreeChat = (plan: TreePlan): number =>
  plan.trunkDepth +
  plan.branchRoots.length * plan.branchDepth +
  plan.wideChildren

export const SCALES: Record<ScaleName, Scale> = {
  small: { chats: 500, messages: 10_000 },
  medium: { chats: 1_000, messages: 20_000 },
  large: { chats: 10_000, messages: 200_000 },
  binary: {
    chats: 1_000,
    messages: 20_000,
    attachments: {
      count: 100,
      imageBytes: 256 * 1024,
      pdfBytes: 1024 * 1024,
      everyNthChat: 10
    }
  },
  tree: {
    chats: 500,
    messages: 500 * messagesPerTreeChat(TREE_PLAN),
    tree: TREE_PLAN
  }
}

export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[]

const content = "x".repeat(2_048)

const measure = async (work: () => void | Promise<void>): Promise<number> => {
  const startedAt = performance.now()
  await work()
  return performance.now() - startedAt
}

const summarize = (samples: number[]): SampleSummary => {
  const sorted = [...samples].sort((left, right) => left - right)
  const percentile = (value: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]
  return { p50: percentile(0.5), p95: percentile(0.95) }
}

const toMiB = (bytes: number): number => bytes / (1024 * 1024)

const makeBlob = (size: number, seed: number): Uint8Array => {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 31 + seed) % 256
  }
  return bytes
}

const createLinearMessages = (database: Database, scale: Scale): void => {
  const insertMessage = database.prepare(
    `INSERT INTO messages (sessionId, role, content, model, timestamp)
     VALUES (?, ?, ?, ?, ?)`
  )
  try {
    const messagesPerChat = scale.messages / scale.chats
    for (let chatIndex = 0; chatIndex < scale.chats; chatIndex += 1) {
      const sessionId = `benchmark-chat-${chatIndex}`
      const timestamp = 1_700_000_000_000 + chatIndex
      for (
        let messageIndex = 0;
        messageIndex < messagesPerChat;
        messageIndex += 1
      ) {
        insertMessage.run([
          sessionId,
          messageIndex % 2 === 0 ? "user" : "assistant",
          content,
          "benchmark-model",
          timestamp + messageIndex
        ])
        insertMessage.reset()
      }
    }
  } finally {
    insertMessage.free()
  }
}

// Explicit message ids so parentId wiring and currentLeafId stay deterministic.
const createTreeMessages = (database: Database, scale: Scale): void => {
  const plan = scale.tree
  if (!plan) throw new Error("Tree scale requires a tree plan")

  const insertMessage = database.prepare(
    `INSERT INTO messages (id, sessionId, role, content, model, timestamp, parentId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const setLeaf = database.prepare(
    "UPDATE sessions SET currentLeafId = ? WHERE id = ?"
  )

  try {
    let nextId = 1
    for (let chatIndex = 0; chatIndex < scale.chats; chatIndex += 1) {
      const sessionId = `benchmark-chat-${chatIndex}`
      const timestamp = 1_700_000_000_000 + chatIndex
      let tick = 0

      const insertNode = (parentId: number | null): number => {
        const id = nextId
        nextId += 1
        tick += 1
        insertMessage.run([
          id,
          sessionId,
          tick % 2 === 1 ? "user" : "assistant",
          content,
          "benchmark-model",
          timestamp + tick,
          parentId
        ])
        insertMessage.reset()
        return id
      }

      const trunkIds: number[] = []
      let parentId: number | null = null
      for (let depth = 0; depth < plan.trunkDepth; depth += 1) {
        parentId = insertNode(parentId)
        trunkIds.push(parentId)
      }

      for (const branchRoot of plan.branchRoots) {
        let branchParent: number = trunkIds[branchRoot - 1]
        for (let depth = 0; depth < plan.branchDepth; depth += 1) {
          branchParent = insertNode(branchParent)
        }
      }

      const wideParent = trunkIds[plan.wideAt - 1]
      for (let child = 0; child < plan.wideChildren; child += 1) {
        insertNode(wideParent)
      }

      setLeaf.run([trunkIds[trunkIds.length - 1], sessionId])
      setLeaf.reset()
    }
  } finally {
    setLeaf.free()
    insertMessage.free()
  }
}

const createAttachments = (database: Database, scale: Scale): void => {
  const plan = scale.attachments
  if (!plan) return

  const insertFile = database.prepare(
    `INSERT INTO files (fileId, sessionId, messageId, fileType, fileName, fileSize, processedAt, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
  try {
    const messagesPerChat = scale.messages / scale.chats
    for (let index = 0; index < plan.count; index += 1) {
      const chatIndex = index * plan.everyNthChat
      const sessionId = `benchmark-chat-${chatIndex}`
      // Linear fixture inserts sequentially, so the first message of chat N
      // has autoincrement id N * messagesPerChat + 1.
      const messageId = chatIndex * messagesPerChat + 1
      const isImage = index % 2 === 0
      const size = isImage ? plan.imageBytes : plan.pdfBytes
      insertFile.run([
        `benchmark-file-${index}`,
        sessionId,
        messageId,
        isImage ? "image/png" : "application/pdf",
        isImage ? `benchmark-${index}.png` : `benchmark-${index}.pdf`,
        size,
        1_700_000_000_000 + index,
        makeBlob(size, index)
      ])
      insertFile.reset()
    }
  } finally {
    insertFile.free()
  }
}

export const createFixture = (SQL: SqlJsStatic, scale: Scale): Database => {
  const database = new SQL.Database()
  database.run(SCHEMA_SQL)
  database.run("BEGIN")

  const insertSession = database.prepare(
    `INSERT INTO sessions (id, title, modelId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`
  )

  try {
    for (let chatIndex = 0; chatIndex < scale.chats; chatIndex += 1) {
      const sessionId = `benchmark-chat-${chatIndex}`
      const timestamp = 1_700_000_000_000 + chatIndex
      insertSession.run([
        sessionId,
        `Benchmark chat ${chatIndex}`,
        "benchmark-model",
        timestamp,
        timestamp
      ])
      insertSession.reset()
    }

    if (scale.tree) {
      createTreeMessages(database, scale)
    } else {
      createLinearMessages(database, scale)
    }
    createAttachments(database, scale)

    database.run("COMMIT")
    return database
  } catch (error) {
    database.run("ROLLBACK")
    database.close()
    throw error
  } finally {
    insertSession.free()
  }
}

const idbRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const openStore = async (
  factory: IDBFactory,
  name: string
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore("sqlite")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const persist = async (
  factory: IDBFactory,
  name: string,
  bytes: Uint8Array
): Promise<void> => {
  const database = await openStore(factory, name)
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("sqlite", "readwrite")
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
      transaction.objectStore("sqlite").put(bytes, "database")
    })
  } finally {
    database.close()
  }
}

const load = async (factory: IDBFactory, name: string): Promise<Uint8Array> => {
  const database = await openStore(factory, name)
  try {
    const value = await idbRequest(
      database
        .transaction("sqlite", "readonly")
        .objectStore("sqlite")
        .get("database")
    )
    if (!(value instanceof Uint8Array)) throw new Error("Missing fixture blob")
    return value
  } finally {
    database.close()
  }
}

export const deleteBenchmarkStore = async (
  factory: IDBFactory,
  scaleName: ScaleName
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(`persistence-benchmark-${scaleName}`)
    request.onsuccess = () => resolve()
    request.onblocked = () => resolve()
    request.onerror = () => reject(request.error)
  })

export const ACTIVE_PATH_SQL = `
WITH RECURSIVE path(id, parentId, role, content, timestamp) AS (
  SELECT id, parentId, role, content, timestamp FROM messages
  WHERE id = (SELECT currentLeafId FROM sessions WHERE id = 'benchmark-chat-0')
  UNION ALL
  SELECT m.id, m.parentId, m.role, m.content, m.timestamp
  FROM messages m JOIN path p ON m.id = p.parentId
)
SELECT id, role, content, timestamp FROM path LIMIT 50`

export interface ScaleResult {
  scale: ScaleName
  chats: number
  messages: number
  iterations: number
  fixtureMiB: number
  fixtureBuildMs: number
  initialExportMs: number
  initialPersistMs: number
  attachments?: { count: number; totalMiB: number }
  treePlan?: TreePlan
  coldOpenMs: SampleSummary
  first50SessionsMs: SampleSummary
  warm50MessagesMs: SampleSummary
  activePath50Ms?: SampleSummary
  durableAppendMs: SampleSummary
  memoryDeltaMiB: number | null
  memoryMetric: string | null
}

export const runScale = async (
  SQL: SqlJsStatic,
  scaleName: ScaleName,
  iterations: number,
  environment: BenchmarkEnvironment,
  onProgress?: (message: string) => void
): Promise<ScaleResult> => {
  const scale = SCALES[scaleName]
  const factory = environment.indexedDB
  const idbName = `persistence-benchmark-${scaleName}`
  const memoryBefore = environment.sampleMemoryBytes()
  onProgress?.(`building ${scaleName} fixture`)
  let fixture: Database | undefined
  const fixtureBuildMs = await measure(() => {
    fixture = createFixture(SQL, scale)
  })
  if (!fixture) throw new Error("Fixture creation failed")

  let fixtureBytes: Uint8Array<ArrayBufferLike> = new Uint8Array()
  const initialExportMs = await measure(() => {
    fixtureBytes = fixture?.export() ?? new Uint8Array()
  })
  const initialPersistMs = await measure(() =>
    persist(factory, idbName, fixtureBytes)
  )

  const coldOpenSamples: number[] = []
  const firstSessionPageSamples: number[] = []
  const warmMessagePageSamples: number[] = []
  const activePathSamples: number[] = []
  const durableAppendSamples: number[] = []

  // One warm-up run is intentionally excluded from reported percentiles.
  for (let iteration = -1; iteration < iterations; iteration += 1) {
    onProgress?.(
      iteration < 0
        ? `${scaleName} warm-up`
        : `${scaleName} iteration ${iteration + 1}/${iterations}`
    )
    let coldDatabase: Database | undefined
    const coldOpenMs = await measure(async () => {
      coldDatabase = new SQL.Database(await load(factory, idbName))
    })
    if (!coldDatabase) throw new Error("Cold database open failed")

    const firstSessionPageMs = await measure(() => {
      coldDatabase?.exec(
        "SELECT id, title, updatedAt FROM sessions ORDER BY updatedAt DESC LIMIT 50"
      )
    })
    const warmMessagePageMs = await measure(() => {
      coldDatabase?.exec(
        `SELECT id, role, content, timestamp FROM messages
         WHERE sessionId = 'benchmark-chat-0'
         ORDER BY timestamp DESC LIMIT 50`
      )
    })
    let activePathMs = 0
    if (scale.tree) {
      activePathMs = await measure(() => {
        coldDatabase?.exec(ACTIVE_PATH_SQL)
      })
    }
    coldDatabase.close()

    const appendDatabase = new SQL.Database(fixtureBytes)
    let durableAppendMs: number
    try {
      durableAppendMs = await measure(async () => {
        appendDatabase.run(
          `INSERT INTO messages (sessionId, role, content, model, timestamp)
           VALUES (?, ?, ?, ?, ?)`,
          [
            "benchmark-chat-0",
            "user",
            "durable append",
            "benchmark-model",
            Date.now()
          ]
        )
        await persist(factory, idbName, appendDatabase.export())
      })
    } finally {
      appendDatabase.close()
      await persist(factory, idbName, fixtureBytes)
    }

    if (iteration >= 0) {
      coldOpenSamples.push(coldOpenMs)
      firstSessionPageSamples.push(firstSessionPageMs)
      warmMessagePageSamples.push(warmMessagePageMs)
      if (scale.tree) activePathSamples.push(activePathMs)
      durableAppendSamples.push(durableAppendMs)
    }
  }

  fixture.close()
  const memoryAfter = environment.sampleMemoryBytes()
  const attachmentTotalBytes = scale.attachments
    ? Array.from({ length: scale.attachments.count }, (_, index) =>
        index % 2 === 0
          ? (scale.attachments as AttachmentPlan).imageBytes
          : (scale.attachments as AttachmentPlan).pdfBytes
      ).reduce((total, size) => total + size, 0)
    : 0

  return {
    scale: scaleName,
    chats: scale.chats,
    messages: scale.messages,
    iterations,
    fixtureMiB: toMiB(fixtureBytes.byteLength),
    fixtureBuildMs,
    initialExportMs,
    initialPersistMs,
    ...(scale.attachments
      ? {
          attachments: {
            count: scale.attachments.count,
            totalMiB: toMiB(attachmentTotalBytes)
          }
        }
      : {}),
    ...(scale.tree ? { treePlan: scale.tree } : {}),
    coldOpenMs: summarize(coldOpenSamples),
    first50SessionsMs: summarize(firstSessionPageSamples),
    warm50MessagesMs: summarize(warmMessagePageSamples),
    ...(scale.tree ? { activePath50Ms: summarize(activePathSamples) } : {}),
    durableAppendMs: summarize(durableAppendSamples),
    memoryDeltaMiB:
      memoryBefore !== null && memoryAfter !== null
        ? toMiB(memoryAfter - memoryBefore)
        : null,
    memoryMetric: environment.memoryMetric
  }
}

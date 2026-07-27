import { beforeEach, describe, expect, it, vi } from "vitest"

import { STORAGE_KEYS } from "@/lib/constants"

const mocks = vi.hoisted(() => ({
  syncGet: vi.fn(),
  syncRemove: vi.fn(),
  initSQLite: vi.fn(),
  query: vi.fn(),
  run: vi.fn(),
  flushSave: vi.fn(),
  withTransaction: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoSyncStorage: { get: mocks.syncGet, remove: mocks.syncRemove }
}))
vi.mock("@/lib/sqlite/db", () => ({
  initSQLite: mocks.initSQLite,
  query: mocks.query,
  run: mocks.run,
  flushSave: mocks.flushSave,
  withTransaction: mocks.withTransaction
}))
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, error: mocks.error }
}))

const LEGACY_PROMPT_KEY = "ollama-prompt-templates"

/** Rows the migration writes, in insert order. */
const insertedTitles = () =>
  mocks.run.mock.calls
    .filter(([sql]) =>
      String(sql).includes("INSERT OR REPLACE INTO prompt_templates")
    )
    .map(([, bind]) => (bind as unknown[])[1])

const legacyTemplate = (
  id: string,
  overrides: Record<string, unknown> = {}
) => ({
  id,
  title: `Template ${id}`,
  userPrompt: `Prompt ${id}`,
  createdAt: new Date(1).toISOString(),
  usageCount: 0,
  ...overrides
})

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.initSQLite.mockResolvedValue(undefined)
  mocks.flushSave.mockResolvedValue(undefined)
  mocks.run.mockResolvedValue(undefined)
  mocks.syncRemove.mockResolvedValue(undefined)
  mocks.syncGet.mockResolvedValue(undefined)
  // No marker, empty table: the first-run migration path.
  mocks.query.mockImplementation(async (sql: string) => {
    if (String(sql).includes("FROM kv_store")) return []
    if (String(sql).includes("COUNT(*) AS count")) return [{ count: 0 }]
    return []
  })
  mocks.withTransaction.mockImplementation(
    async (work: () => Promise<unknown>) => work()
  )
})

/** Fresh module per test — the migration memoizes its promise. */
const load = async () => import("../prompt-templates")

describe("prompt template migration", () => {
  it("writes SQLite and flushes before removing the legacy keys", async () => {
    mocks.syncGet.mockResolvedValueOnce([legacyTemplate("a")])
    const { ensurePromptTemplatesMigrated } = await load()

    await ensurePromptTemplatesMigrated()

    expect(insertedTitles()).toEqual(["Template a"])
    // Ordering is the whole safety argument: a crash between the write and the
    // flush must not have already deleted the source.
    const flushedAt = mocks.flushSave.mock.invocationCallOrder[0]
    const removedAt = mocks.syncRemove.mock.invocationCallOrder[0]
    expect(flushedAt).toBeLessThan(removedAt)
    expect(mocks.syncRemove).toHaveBeenCalledWith(
      STORAGE_KEYS.PROVIDER.PROMPT_TEMPLATES
    )
    expect(mocks.syncRemove).toHaveBeenCalledWith(LEGACY_PROMPT_KEY)
  })

  it("keeps the legacy keys when any entry failed validation", async () => {
    mocks.syncGet.mockResolvedValueOnce([
      legacyTemplate("good"),
      legacyTemplate("bad", { title: "" })
    ])
    const { ensurePromptTemplatesMigrated } = await load()

    await ensurePromptTemplatesMigrated()

    expect(insertedTitles()).toEqual(["Template good"])
    // The rejected entry is not a template the user agreed to lose.
    expect(mocks.syncRemove).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining("Kept legacy prompt-template storage"),
      "PromptTemplates",
      expect.objectContaining({ dropped: 1, migrated: 1 })
    )
  })

  it("does not replace an all-invalid library with the built-in defaults", async () => {
    // The worst case: every entry fails, the seed falls back to defaults, and
    // deleting the keys would leave nothing to recover the originals from.
    mocks.syncGet.mockResolvedValueOnce([
      legacyTemplate("bad-title", { title: "" }),
      legacyTemplate("bad-prompt", { userPrompt: "" })
    ])
    const { ensurePromptTemplatesMigrated } = await load()

    await ensurePromptTemplatesMigrated()

    expect(mocks.syncRemove).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.anything(),
      "PromptTemplates",
      expect.objectContaining({ dropped: 2, migrated: 0 })
    )
  })

  it("seeds the built-in defaults when there is nothing to migrate", async () => {
    const { ensurePromptTemplatesMigrated } = await load()

    await ensurePromptTemplatesMigrated()

    expect(insertedTitles().length).toBeGreaterThan(0)
    // Nothing was dropped, so the (absent) legacy keys are still cleared.
    expect(mocks.syncRemove).toHaveBeenCalled()
    expect(mocks.warn).not.toHaveBeenCalled()
  })

  it("falls back to the pre-provider key only when the current one is unset", async () => {
    mocks.syncGet.mockImplementation(async (key: string) =>
      key === LEGACY_PROMPT_KEY ? [legacyTemplate("old")] : undefined
    )
    const { ensurePromptTemplatesMigrated } = await load()

    await ensurePromptTemplatesMigrated()

    expect(insertedTitles()).toEqual(["Template old"])
  })

  it("runs once across concurrent callers", async () => {
    mocks.syncGet.mockResolvedValueOnce([legacyTemplate("a")])
    const { ensurePromptTemplatesMigrated } = await load()

    await Promise.all([
      ensurePromptTemplatesMigrated(),
      ensurePromptTemplatesMigrated(),
      ensurePromptTemplatesMigrated()
    ])

    expect(mocks.withTransaction).toHaveBeenCalledOnce()
  })

  it("skips the whole migration once the marker is committed", async () => {
    mocks.query.mockImplementation(async (sql: string) =>
      String(sql).includes("FROM kv_store") ? [{ value: "complete" }] : []
    )
    const { ensurePromptTemplatesMigrated } = await load()

    await ensurePromptTemplatesMigrated()

    expect(mocks.withTransaction).not.toHaveBeenCalled()
    expect(mocks.syncRemove).not.toHaveBeenCalled()
  })

  it("retries after a failure instead of caching the rejection", async () => {
    mocks.initSQLite.mockRejectedValueOnce(new Error("db unavailable"))
    const { ensurePromptTemplatesMigrated } = await load()

    await expect(ensurePromptTemplatesMigrated()).rejects.toThrow(
      "db unavailable"
    )
    await expect(ensurePromptTemplatesMigrated()).resolves.toBeUndefined()
  })
})

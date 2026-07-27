import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PromptTemplate } from "@/types/ui-state"
import { usePromptTemplates } from "../use-prompt-templates"

const repository = vi.hoisted(() => ({
  list: vi.fn<() => Promise<PromptTemplate[]>>(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  increment: vi.fn(),
  importMany: vi.fn(),
  replace: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  logError: vi.fn()
}))

vi.mock("@/lib/repositories/prompt-templates", () => ({
  listPromptTemplates: repository.list,
  addPromptTemplate: repository.add,
  updatePromptTemplate: repository.update,
  deletePromptTemplate: repository.remove,
  incrementPromptTemplateUsage: repository.increment,
  importPromptTemplates: repository.importMany,
  replacePromptTemplates: repository.replace,
  subscribePromptTemplates: repository.subscribe,
  logPromptTemplateError: repository.logError
}))

const template = (
  id: string,
  overrides: Partial<PromptTemplate> = {}
): PromptTemplate => ({
  id,
  title: `Template ${id}`,
  userPrompt: `Prompt ${id}`,
  createdAt: new Date(1),
  usageCount: 0,
  ...overrides
})

describe("usePromptTemplates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repository.list.mockResolvedValue([template("one")])
    repository.add.mockResolvedValue(undefined)
    repository.update.mockResolvedValue(undefined)
    repository.remove.mockResolvedValue(undefined)
    repository.increment.mockResolvedValue(undefined)
    repository.importMany.mockResolvedValue(undefined)
    repository.replace.mockResolvedValue(undefined)
    repository.subscribe.mockReturnValue(() => undefined)
  })

  it("loads templates from SQLite repository", async () => {
    const { result } = renderHook(() => usePromptTemplates())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.templates.map(({ id }) => id)).toEqual(["one"])
  })

  it("persists individual CRUD without rewriting an array", async () => {
    const { result } = renderHook(() => usePromptTemplates())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.addTemplate({
        id: "two",
        title: "Two",
        userPrompt: "Use two"
      })
      result.current.updateTemplate("one", { title: "Updated" })
      result.current.incrementUsageCount("one")
      result.current.deleteTemplate("one")
    })

    expect(repository.add).toHaveBeenCalledWith(
      expect.objectContaining({ id: "two", usageCount: 0 })
    )
    expect(repository.update).toHaveBeenCalledWith("one", { title: "Updated" })
    expect(repository.increment).toHaveBeenCalledWith("one")
    expect(repository.remove).toHaveBeenCalledWith("one")
  })

  it("validates imports and replaces duplicate ids", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "new-id") })
    const { result } = renderHook(() => usePromptTemplates())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.importTemplates([
        { id: "one", title: "Imported", userPrompt: "Valid", tags: ["x", 1] },
        { id: "bad", title: "", userPrompt: "Invalid" }
      ])
    })

    expect(repository.importMany).toHaveBeenCalledWith([
      expect.objectContaining({ id: "new-id", tags: ["x"] })
    ])
    vi.unstubAllGlobals()
  })

  it("drops non-object entries from an import without rejecting the batch", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "new-id") })
    const { result } = renderHook(() => usePromptTemplates())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.importTemplates([
        null,
        "not-a-template",
        { id: "fresh", title: "Valid", userPrompt: "Keep me" }
      ])
    })

    expect(repository.importMany).toHaveBeenCalledWith([
      expect.objectContaining({ id: "fresh", title: "Valid" })
    ])
    vi.unstubAllGlobals()
  })

  it("duplicates a template as an independent copy", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "copy-id") })
    repository.list.mockResolvedValue([
      template("one", { title: "Original", usageCount: 7 })
    ])
    const { result } = renderHook(() => usePromptTemplates())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.duplicateTemplate("one")
    })

    // A copy that kept the source id or its usage count would overwrite the
    // original on the next write and inherit stats it never earned.
    expect(repository.add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "copy-id",
        title: "Original (Copy)",
        usageCount: 0
      })
    )
    vi.unstubAllGlobals()
  })

  it("ignores a duplicate request for an unknown id", async () => {
    const { result } = renderHook(() => usePromptTemplates())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.duplicateTemplate("missing")
    })

    expect(repository.add).not.toHaveBeenCalled()
  })

  it("replaces the library wholesale when resetting to defaults", async () => {
    const { result } = renderHook(() => usePromptTemplates())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => {
      result.current.resetToDefaults()
    })

    // Reset must replace, not append — `add` would leave the old library in
    // place alongside the defaults.
    expect(repository.replace).toHaveBeenCalledOnce()
    expect(repository.add).not.toHaveBeenCalled()
    const [defaults] = repository.replace.mock.calls[0] as [PromptTemplate[]]
    expect(defaults.length).toBeGreaterThan(0)
    expect(defaults.every((entry) => entry.createdAt instanceof Date)).toBe(
      true
    )
  })

  it("orders recent templates by creation time, not insertion order", async () => {
    repository.list.mockResolvedValue([
      template("old", { createdAt: new Date(1_000) }),
      template("newest", { createdAt: new Date(9_000) }),
      template("middle", { createdAt: new Date(5_000) })
    ])
    const { result } = renderHook(() => usePromptTemplates())
    await waitFor(() => expect(result.current.templates).toHaveLength(3))

    expect(result.current.getRecentTemplates(2).map(({ id }) => id)).toEqual([
      "newest",
      "middle"
    ])
  })

  it("keeps search, category, popularity, and export helpers", async () => {
    repository.list.mockResolvedValue([
      template("a", { title: "Code Review", category: "Code", usageCount: 9 }),
      template("b", { title: "Write", category: "Writing", usageCount: 2 })
    ])
    const { result } = renderHook(() => usePromptTemplates())
    await waitFor(() => expect(result.current.templates).toHaveLength(2))

    expect(result.current.searchTemplates("code")[0]?.id).toBe("a")
    expect(result.current.getTemplatesByCategory("Writing")[0]?.id).toBe("b")
    expect(result.current.getPopularTemplates(1)[0]?.id).toBe("a")
    expect(result.current.getCategories()).toEqual(["Code", "Writing"])
    expect(result.current.exportTemplates()).toHaveLength(2)
  })
})

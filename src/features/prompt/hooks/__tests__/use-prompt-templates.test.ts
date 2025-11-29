import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { usePromptTemplates } from "../use-prompt-templates"

// Mock useStorage
vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn()
}))

import { useStorage } from "@plasmohq/storage/hook"

describe("usePromptTemplates", () => {
  let mockSetTemplates: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSetTemplates = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useStorage).mockReturnValue([
      [],
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])
  })

  it("should initialize with empty templates", () => {
    const { result } = renderHook(() => usePromptTemplates())

    expect(result.current.templates).toBeDefined()
  })

  it("should add a new template", () => {
    const { result } = renderHook(() => usePromptTemplates())

    act(() => {
      result.current.addTemplate({
        id: "test-1",
        title: "Test Template",
        userPrompt: "Test prompt",
        category: "Test"
      })
    })

    expect(mockSetTemplates).toHaveBeenCalled()
  })

  it("should update a template", () => {
    const mockTemplates = [
      {
        id: "template-1",
        title: "Original",
        userPrompt: "Prompt",
        createdAt: new Date(),
        usageCount: 0
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    act(() => {
      result.current.updateTemplate("template-1", { title: "Updated" })
    })

    expect(mockSetTemplates).toHaveBeenCalled()
  })

  it("should delete a template", () => {
    const mockTemplates = [
      {
        id: "template-1",
        title: "Test",
        userPrompt: "Prompt",
        createdAt: new Date(),
        usageCount: 0
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    act(() => {
      result.current.deleteTemplate("template-1")
    })

    expect(mockSetTemplates).toHaveBeenCalled()
  })

  it("should increment usage count", () => {
    const mockTemplates = [
      {
        id: "template-1",
        title: "Test",
        userPrompt: "Prompt",
        createdAt: new Date(),
        usageCount: 5
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    act(() => {
      result.current.incrementUsageCount("template-1")
    })

    expect(mockSetTemplates).toHaveBeenCalled()
  })

  it("should duplicate a template", () => {
    const mockTemplates = [
      {
        id: "template-1",
        title: "Original",
        userPrompt: "Prompt",
        createdAt: new Date(),
        usageCount: 5
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    act(() => {
      result.current.duplicateTemplate("template-1")
    })

    expect(mockSetTemplates).toHaveBeenCalled()
  })

  it("should import templates", () => {
    const { result } = renderHook(() => usePromptTemplates())

    const newTemplates = [
      {
        id: "imported-1",
        title: "Imported",
        userPrompt: "Prompt",
        createdAt: new Date(),
        usageCount: 0
      }
    ]

    act(() => {
      result.current.importTemplates(newTemplates)
    })

    expect(mockSetTemplates).toHaveBeenCalled()
  })

  it("should export templates", () => {
    const mockTemplates = [
      {
        id: "template-1",
        title: "Test",
        userPrompt: "Prompt",
        createdAt: new Date(),
        usageCount: 0
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    const exported = result.current.exportTemplates()

    expect(exported).toEqual(mockTemplates)
  })

  it("should reset to defaults", () => {
    const { result } = renderHook(() => usePromptTemplates())

    act(() => {
      result.current.resetToDefaults()
    })

    expect(mockSetTemplates).toHaveBeenCalled()
  })

  it("should get templates by category", () => {
    const mockTemplates = [
      {
        id: "1",
        title: "Test 1",
        userPrompt: "Prompt",
        category: "Code",
        createdAt: new Date(),
        usageCount: 0
      },
      {
        id: "2",
        title: "Test 2",
        userPrompt: "Prompt",
        category: "Writing",
        createdAt: new Date(),
        usageCount: 0
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    const codeTemplates = result.current.getTemplatesByCategory("Code")

    expect(codeTemplates).toHaveLength(1)
    expect(codeTemplates[0].title).toBe("Test 1")
  })

  it("should search templates", () => {
    const mockTemplates = [
      {
        id: "1",
        title: "Code Review",
        userPrompt: "Review code",
        createdAt: new Date(),
        usageCount: 0
      },
      {
        id: "2",
        title: "Writing Help",
        userPrompt: "Help writing",
        createdAt: new Date(),
        usageCount: 0
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    const results = result.current.searchTemplates("code")

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe("Code Review")
  })

  it("should get categories", () => {
    const mockTemplates = [
      {
        id: "1",
        title: "Test 1",
        userPrompt: "Prompt",
        category: "Code",
        createdAt: new Date(),
        usageCount: 0
      },
      {
        id: "2",
        title: "Test 2",
        userPrompt: "Prompt",
        category: "Writing",
        createdAt: new Date(),
        usageCount: 0
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    const categories = result.current.getCategories()

    expect(categories).toContain("Code")
    expect(categories).toContain("Writing")
  })

  it("should get popular templates", () => {
    const mockTemplates = [
      {
        id: "1",
        title: "Popular",
        userPrompt: "Prompt",
        createdAt: new Date(),
        usageCount: 100
      },
      {
        id: "2",
        title: "Less Popular",
        userPrompt: "Prompt",
        createdAt: new Date(),
        usageCount: 10
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    const popular = result.current.getPopularTemplates(1)

    expect(popular).toHaveLength(1)
    expect(popular[0].title).toBe("Popular")
  })

  it("should get recent templates", () => {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 86400000)

    const mockTemplates = [
      {
        id: "1",
        title: "Recent",
        userPrompt: "Prompt",
        createdAt: now,
        usageCount: 0
      },
      {
        id: "2",
        title: "Old",
        userPrompt: "Prompt",
        createdAt: yesterday,
        usageCount: 0
      }
    ]

    vi.mocked(useStorage).mockReturnValue([
      mockTemplates,
      mockSetTemplates as any,
      {
        setRenderValue: vi.fn(),
        setStoreValue: vi.fn(),
        remove: vi.fn(),
        isLoading: false
      }
    ])

    const { result } = renderHook(() => usePromptTemplates())

    const recent = result.current.getRecentTemplates(1)

    expect(recent).toHaveLength(1)
    expect(recent[0].title).toBe("Recent")
  })
})

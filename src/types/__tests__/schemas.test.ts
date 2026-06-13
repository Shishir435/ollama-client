import { describe, expect, it } from "vitest"
import {
  ChatMessageMetricsSchema,
  ChatMessageSchema,
  ChatSessionImportSchema,
  ChatSessionSchema
} from "../chat.schemas"
import { PromptTemplateSchema, ThemeSchema } from "../ui-state.schemas"

describe("ChatMessageSchema", () => {
  it("accepts a minimal valid message", () => {
    const result = ChatMessageSchema.safeParse({
      role: "user",
      content: "hello"
    })
    expect(result.success).toBe(true)
  })

  it("accepts a full message with all optional fields", () => {
    const result = ChatMessageSchema.safeParse({
      role: "assistant",
      content: "response",
      thinking: "hmm",
      done: true,
      model: "llama3",
      toolName: "read_tab",
      toolCallId: "call-1",
      toolCalls: [
        {
          id: "call-1",
          name: "read_tab",
          arguments: { query: "docs" }
        }
      ],
      images: [
        {
          imageId: "img-1",
          fileName: "photo.png",
          mimeType: "image/png",
          size: 123,
          base64: "abc",
          width: 10,
          height: 10
        }
      ],
      timestamp: 1700000000
    })
    expect(result.success).toBe(true)
  })

  it("strips unknown keys (default strip mode)", () => {
    const result = ChatMessageSchema.safeParse({
      role: "user",
      content: "hello",
      customField: 42
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain("customField")
    }
  })

  it("rejects invalid role", () => {
    const result = ChatMessageSchema.safeParse({
      role: "invalid",
      content: "hello"
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing content", () => {
    const result = ChatMessageSchema.safeParse({ role: "user" })
    expect(result.success).toBe(false)
  })
})

describe("ChatSessionSchema", () => {
  it("accepts a valid session without messages", () => {
    const result = ChatSessionSchema.safeParse({
      id: "abc",
      title: "My Chat",
      createdAt: 1700000000,
      updatedAt: 1700000000
    })
    expect(result.success).toBe(true)
  })

  it("accepts a session with messages array", () => {
    const result = ChatSessionSchema.safeParse({
      id: "abc",
      title: "My Chat",
      createdAt: 1700000000,
      updatedAt: 1700000000,
      messages: [{ role: "user", content: "hi" }]
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing id", () => {
    const result = ChatSessionSchema.safeParse({
      title: "My Chat",
      createdAt: 1700000000,
      updatedAt: 1700000000
    })
    expect(result.success).toBe(false)
  })
})

describe("ChatSessionImportSchema", () => {
  it("requires messages array", () => {
    const result = ChatSessionImportSchema.safeParse({
      id: "abc",
      title: "My Chat",
      createdAt: 1700000000,
      updatedAt: 1700000000
    })
    expect(result.success).toBe(false)
  })

  it("accepts session with messages", () => {
    const result = ChatSessionImportSchema.safeParse({
      id: "abc",
      title: "My Chat",
      createdAt: 1700000000,
      updatedAt: 1700000000,
      messages: [{ role: "user", content: "hello" }]
    })
    expect(result.success).toBe(true)
  })
})

describe("ChatMessageMetricsSchema", () => {
  it("accepts empty object", () => {
    const result = ChatMessageMetricsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it("accepts typical ollama metrics", () => {
    const result = ChatMessageMetricsSchema.safeParse({
      total_duration: 1234567890,
      eval_count: 100,
      eval_duration: 500000000
    })
    expect(result.success).toBe(true)
  })

  it("accepts tool run metadata", () => {
    const result = ChatMessageMetricsSchema.safeParse({
      toolRuns: [
        {
          toolId: "web_search",
          label: "Web search",
          displayNameKey: "chat.reasoning.trace.web",
          iconKey: "search",
          category: "web",
          risk: "low",
          status: "done",
          startedAt: 1,
          completedAt: 2,
          sources: [{ title: "Example", url: "https://example.com" }]
        }
      ]
    })

    expect(result.success).toBe(true)
  })

  it("strips unknown keys (default strip mode)", () => {
    const result = ChatMessageMetricsSchema.safeParse({
      total_duration: 100,
      future_field: "ok"
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain("future_field")
    }
  })
})

describe("PromptTemplateSchema", () => {
  it("accepts a valid template", () => {
    const result = PromptTemplateSchema.safeParse({
      id: "t1",
      title: "Summarize",
      userPrompt: "Please summarize the following:"
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.usageCount).toBe(0) // default
      expect(result.data.createdAt).toBeInstanceOf(Date) // transformed
    }
  })

  it("transforms string createdAt to Date", () => {
    const result = PromptTemplateSchema.safeParse({
      id: "t1",
      title: "Test",
      userPrompt: "test",
      createdAt: "2024-01-01T00:00:00.000Z"
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.createdAt).toBeInstanceOf(Date)
    }
  })

  it("transforms numeric createdAt to Date", () => {
    const result = PromptTemplateSchema.safeParse({
      id: "t1",
      title: "Test",
      userPrompt: "test",
      createdAt: 1700000000000
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.createdAt).toBeInstanceOf(Date)
    }
  })

  it("rejects empty title", () => {
    const result = PromptTemplateSchema.safeParse({
      id: "t1",
      title: "",
      userPrompt: "test"
    })
    expect(result.success).toBe(false)
  })

  it("rejects empty userPrompt", () => {
    const result = PromptTemplateSchema.safeParse({
      id: "t1",
      title: "Test",
      userPrompt: ""
    })
    expect(result.success).toBe(false)
  })

  it("rejects missing required fields", () => {
    const result = PromptTemplateSchema.safeParse({
      description: "only a description"
    })
    expect(result.success).toBe(false)
  })
})

describe("ThemeSchema", () => {
  it("accepts valid themes", () => {
    expect(ThemeSchema.safeParse("dark").success).toBe(true)
    expect(ThemeSchema.safeParse("light").success).toBe(true)
    expect(ThemeSchema.safeParse("system").success).toBe(true)
  })

  it("rejects invalid theme", () => {
    expect(ThemeSchema.safeParse("auto").success).toBe(false)
    expect(ThemeSchema.safeParse(123).success).toBe(false)
  })
})

import { describe, expect, it, vi } from "vitest"

import {
  buildRAGMessages,
  buildRAGPrompt,
  formatSources
} from "../rag-prompt-builder"
import { knowledgeConfig } from "@/lib/config/knowledge-config"

vi.mock("@/lib/config/knowledge-config", () => ({
  knowledgeConfig: {
    getSystemPrompt: vi.fn().mockResolvedValue("Context: {context}\nQuestion: {question}")
  }
}))

describe("buildRAGPrompt", () => {
  it("substitutes context and question into template", async () => {
    const context = {
      documents: [],
      formattedContext: "Retrieved content",
      sources: []
    }
    const question = "User question"

    const prompt = await buildRAGPrompt(question, context)

    expect(prompt).toBe("Context: Retrieved content\nQuestion: User question")
    expect(knowledgeConfig.getSystemPrompt).toHaveBeenCalled()
  })
})

describe("buildRAGMessages", () => {
  it("creates system message and appends history", () => {
    const ragPrompt = "System prompt"
    const history = [
      { role: "user" as const, content: "Previous user msg" },
      { role: "assistant" as const, content: "Previous assistant msg" }
    ]

    const messages = buildRAGMessages(ragPrompt, history)

    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({ role: "system", content: ragPrompt })
    expect(messages[1]).toEqual(history[0])
    expect(messages[2]).toEqual(history[1])
  })
})

describe("formatSources", () => {
  it("formats sources for UI", () => {
    const sources = [
      {
        title: "Doc 1",
        type: "pdf",
        chunkIndex: 0,
        fileId: "file1"
      }
    ]

    const formatted = formatSources(sources)

    expect(formatted).toHaveLength(1)
    expect(formatted[0]).toEqual({
      name: "Doc 1",
      type: "pdf",
      mode: "rag",
      url: "#file:file1"
    })
  })
})

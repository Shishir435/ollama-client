import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/types"
import { prepareTurnSubmission } from "../prepare-turn-submission"

const policy = {
  id: "turn-1",
  sessionId: "session-1",
  model: "llama3",
  selectedModel: "llama3",
  selectedModelRef: { providerId: "ollama", modelId: "llama3" },
  memoryEnabled: true,
  maxTabContextChars: 4_000,
  maxRagContextChars: 8_000,
  createdAt: 123
}

describe("prepareTurnSubmission", () => {
  it("builds a new turn with captured tab and file context", () => {
    const priorMessages: ChatMessage[] = [
      { id: 1, role: "user", content: "earlier" },
      { id: 2, role: "assistant", content: "answer", done: true }
    ]
    const userMessage: ChatMessage = {
      role: "user",
      content: "summarize",
      images: [
        {
          imageId: "image-1",
          fileName: "chart.png",
          mimeType: "image/png",
          size: 1,
          base64: "AA=="
        }
      ]
    }

    const result = prepareTurnSubmission({
      ...policy,
      mode: "new",
      userMessage,
      userMessageId: 3,
      priorMessages,
      rawInput: "summarize",
      files: [
        {
          text: "file body",
          metadata: { fileName: "notes.txt", fileId: "file-1" }
        }
      ],
      hasTabContext: true,
      contextText: "page body",
      tabDocuments: [{ id: "tab-1", title: "Page", content: "page body" }],
      groundedOnlyMode: true
    })

    expect(result).toEqual({
      submission: {
        id: "turn-1",
        sessionId: "session-1",
        mode: "new",
        model: "llama3",
        providerId: "ollama",
        request: {
          version: 1,
          context: {
            rawInput: "summarize",
            files: [
              {
                text: "file body",
                metadata: { fileName: "notes.txt", fileId: "file-1" }
              }
            ],
            messages: priorMessages,
            hasTabContext: true,
            contextText: "page body",
            tabDocuments: [
              { id: "tab-1", title: "Page", content: "page body" }
            ],
            groundedOnlyMode: true,
            memoryEnabled: true,
            maxTabContextChars: 4_000,
            maxRagContextChars: 8_000,
            selectedModel: "llama3",
            selectedModelRef: {
              providerId: "ollama",
              modelId: "llama3"
            }
          },
          userMessage
        },
        createdAt: 123
      },
      userMessageId: 3
    })
  })

  it.each([
    "regenerate",
    "fork"
  ] as const)("builds a %s turn from the last persisted user", (mode) => {
    const contextMessages: ChatMessage[] = [
      { id: 1, role: "user", content: "first" },
      { id: 2, role: "assistant", content: "first answer", done: true },
      { id: 3, role: "user", content: "again" }
    ]

    const result = prepareTurnSubmission({
      ...policy,
      mode,
      contextMessages
    })

    expect(result).toMatchObject({
      submission: {
        mode,
        providerId: "ollama",
        request: {
          context: {
            rawInput: "again",
            messages: contextMessages.slice(0, 2),
            hasTabContext: false,
            contextText: "",
            tabDocuments: [],
            groundedOnlyMode: false
          },
          userMessage: contextMessages[2]
        }
      },
      userMessageId: 3
    })
  })

  it("does not build a replay turn without a persisted user message", () => {
    expect(
      prepareTurnSubmission({
        ...policy,
        mode: "regenerate",
        contextMessages: [
          { id: 1, role: "user", content: "persisted earlier" },
          { id: 2, role: "assistant", content: "answer" },
          { role: "user", content: "not persisted" }
        ]
      })
    ).toBeUndefined()
  })
})

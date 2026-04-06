import { describe, expect, it } from "vitest"

import { CharacterTextSplitter } from "../character-text-splitter"
import { RecursiveCharacterTextSplitter } from "../recursive-character-text-splitter"

describe("CharacterTextSplitter", () => {
  it("splits text by characters", async () => {
    const splitter = new CharacterTextSplitter({
      chunkSize: 10,
      chunkOverlap: 0,
      separator: ""
    })
    const text = "helloworld"
    const chunks = await splitter.splitText(text)
    expect(chunks).toEqual(["helloworld"])
  })

  it("splits text with overlap", async () => {
    const splitter = new CharacterTextSplitter({
      chunkSize: 5,
      chunkOverlap: 2,
      separator: ""
    })
    const text = "helloworld"
    const chunks = await splitter.splitText(text)
    console.log("CHUNKS:", JSON.stringify(chunks))
    // Based on logic: ["hello", "lowor", "orld"]
    expect(chunks).toEqual(["hello", "lowor", "orld"])
  })

  it("respects separator", async () => {
    const splitter = new CharacterTextSplitter({
      chunkSize: 10,
      chunkOverlap: 0,
      separator: " "
    })
    const text = "hello world"
    const chunks = await splitter.splitText(text)
    expect(chunks).toEqual(["hello", "world"])
  })
})

describe("RecursiveCharacterTextSplitter", () => {
  it("splits by paragraphs", async () => {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 20,
      chunkOverlap: 0
    })
    const text = "Paragraph 1.\n\nParagraph 2."
    const chunks = await splitter.splitText(text)
    expect(chunks).toEqual(["Paragraph 1.", "Paragraph 2."])
  })

  it("splits by sentences when paragraphs are too long", async () => {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 15,
      chunkOverlap: 0
    })
    const text = "Hello world. How are you?"
    const chunks = await splitter.splitText(text)
    expect(chunks).toEqual(["Hello world", "How are you?"])
  })

  it("preserves metadata when splitting documents", async () => {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 10,
      chunkOverlap: 0
    })
    const docs = [
      {
        pageContent: "Test content",
        metadata: { source: "test.txt" }
      }
    ]
    const chunks = await splitter.splitDocuments(docs)
    expect(chunks[0].metadata).toEqual({
      source: "test.txt",
      chunkIndex: 0,
      totalChunks: 2 // "Test content" (12 chars) -> "Test", "content" (split by space) or similar.
      // Actually "Test content" -> "Test" (4), "content" (7).
      // Wait, "Test content" is 12 chars. Chunk size 10.
      // Recursive splitter defaults separators: ["\n\n", "\n", " ", ""].
      // Split by space: "Test", "content".
      // "Test" (4) < 10.
      // "content" (7) < 10.
      // So 2 chunks.
    })
    expect(chunks[0].metadata).toMatchObject({ source: "test.txt" })
  })
})

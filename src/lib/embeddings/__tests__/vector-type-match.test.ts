import { describe, expect, it } from "vitest"

import { matchesVectorType } from "../types"

describe("matchesVectorType", () => {
  it("matches exact categories", () => {
    expect(matchesVectorType("file", "file")).toBe(true)
    expect(matchesVectorType("chat", "chat")).toBe(true)
    expect(matchesVectorType("webpage", "webpage")).toBe(true)
  })

  it("does not cross-match known categories", () => {
    expect(matchesVectorType("chat", "file")).toBe(false)
    expect(matchesVectorType("webpage", "file")).toBe(false)
    expect(matchesVectorType("file", "chat")).toBe(false)
  })

  it("treats legacy MIME-typed rows as files", () => {
    // A knowledge-processor bug wrote the MIME type into metadata.type;
    // those rows must stay visible to type:"file" queries (attachment
    // preview, file search) without a data migration.
    expect(matchesVectorType("text/html", "file")).toBe(true)
    expect(matchesVectorType("text/plain", "file")).toBe(true)
    expect(matchesVectorType("application/pdf", "file")).toBe(true)
    expect(matchesVectorType(undefined, "file")).toBe(true)
  })

  it("never widens non-file queries", () => {
    expect(matchesVectorType("text/html", "chat")).toBe(false)
    expect(matchesVectorType(undefined, "webpage")).toBe(false)
  })
})

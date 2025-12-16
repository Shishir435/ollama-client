import { describe, it, expect } from "vitest"
import { db } from "../db"

describe("ChatDatabase", () => {
  it("should initialize database with sessions, messages, and files tables", () => {
    expect(db).toBeDefined()
    expect(db.sessions).toBeDefined()
    expect(db.messages).toBeDefined()
    expect(db.files).toBeDefined()
  })

  it("should have correct schema for sessions table", () => {
    const schema = db.sessions.schema
    expect(schema.primKey.name).toBe("id")
    expect(schema.indexes.map(i => i.name)).toContain("createdAt")
    expect(schema.indexes.map(i => i.name)).toContain("updatedAt")
    expect(schema.indexes.map(i => i.name)).toContain("modelId")
  })

  it("should have correct schema for messages table", () => {
    const schema = db.messages.schema
    expect(schema.primKey.name).toBe("id")
    expect(schema.primKey.auto).toBe(true)
    expect(schema.indexes.map(i => i.name)).toContain("sessionId")
    expect(schema.indexes.map(i => i.name)).toContain("timestamp")
  })

  it("should have correct schema for files table", () => {
    const schema = db.files.schema
    expect(schema.primKey.name).toBe("id")
    expect(schema.primKey.auto).toBe(true)
    expect(schema.indexes.map(i => i.name)).toContain("sessionId")
  })

  it("should be named ChatDatabase", () => {
    expect(db.name).toBe("ChatDatabase")
  })

  it("should be version 3", () => {
    expect(db.verno).toBe(3)
  })
})

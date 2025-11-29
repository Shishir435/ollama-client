import { describe, it, expect } from "vitest"
import { db } from "../db"

describe("ChatDatabase", () => {
  it("should initialize database with sessions table", () => {
    expect(db).toBeDefined()
    expect(db.sessions).toBeDefined()
  })

  it("should have correct schema for sessions table", () => {
    const schema = db.sessions.schema
    expect(schema.primKey.name).toBe("id")
    expect(schema.indexes).toHaveLength(2) // createdAt, updatedAt
  })

  it("should be named ChatDatabase", () => {
    expect(db.name).toBe("ChatDatabase")
  })

  it("should be version 1", () => {
    expect(db.verno).toBe(1)
  })
})

import { describe, it, expect } from "vitest"
import { plasmoGlobalStorage } from "../plasmo-global-storage"

describe("plasmoGlobalStorage", () => {
  it("should be defined", () => {
    expect(plasmoGlobalStorage).toBeDefined()
  })

  it("should have get method", () => {
    expect(typeof plasmoGlobalStorage.get).toBe("function")
  })

  it("should have set method", () => {
    expect(typeof plasmoGlobalStorage.set).toBe("function")
  })
})

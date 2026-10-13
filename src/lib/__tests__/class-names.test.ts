import { describe, expect, it, vi } from "vitest"
import { cn } from "../class-names"

describe("utils", () => {
  describe("cn", () => {
    it("should merge class names", () => {
      expect(cn("foo", "bar")).toBe("foo bar")
    })

    it("should handle conditional classes", () => {
      const enabled = vi.fn(() => true)()
      const disabled = vi.fn(() => false)()
      expect(cn("foo", enabled && "bar", disabled && "baz")).toBe("foo bar")
    })

    it("should merge tailwind classes", () => {
      expect(cn("p-4 p-2")).toBe("p-2")
      expect(cn("text-status-danger", "text-feature-2")).toBe("text-feature-2")
    })
  })
})

import { describe, expect, it } from "vitest"
import { cn } from "../utils"

describe("utils", () => {
  describe("cn", () => {
    it("should merge class names", () => {
      expect(cn("foo", "bar")).toBe("foo bar")
    })

    it("should handle conditional classes", () => {
      expect(cn("foo", true && "bar", false && "baz")).toBe("foo bar")
    })

    it("should merge tailwind classes", () => {
      expect(cn("p-4 p-2")).toBe("p-2")
      expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500")
    })
  })
})

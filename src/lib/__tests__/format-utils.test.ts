import { describe, expect, it } from "vitest"
import {
  formatDuration,
  formatTokensPerSecond,
  formatUsd
} from "../format-utils"

describe("format-utils", () => {
  describe("formatUsd", () => {
    it("keeps sub-cent costs distinguishable", () => {
      expect(formatUsd(1.234)).toBe("$1.23")
      expect(formatUsd(0.0567)).toBe("$0.057")
      expect(formatUsd(0.0042)).toBe("$0.0042")
      expect(formatUsd(0.000012)).toBe("$0.000012")
    })
  })

  describe("formatDuration", () => {
    it("should format milliseconds", () => {
      expect(formatDuration(500 * 1_000_000)).toBe("500ms")
    })

    it("should format seconds", () => {
      expect(formatDuration(1500 * 1_000_000)).toBe("1.5s")
    })

    it("should format minutes", () => {
      expect(formatDuration(65 * 1000 * 1_000_000)).toBe("1.1m")
    })

    it("should handle undefined/zero", () => {
      expect(formatDuration(undefined)).toBe("0ms")
      expect(formatDuration(0)).toBe("0ms")
    })
  })

  describe("formatTokensPerSecond", () => {
    it("should calculate t/s", () => {
      expect(formatTokensPerSecond(10, 1_000_000_000)).toBe("10 t/s")
    })

    it("should handle undefined/zero", () => {
      expect(formatTokensPerSecond(undefined, 100)).toBe("—")
      expect(formatTokensPerSecond(100, undefined)).toBe("—")
    })

    it("should hide bogus tiny-duration speeds", () => {
      expect(formatTokensPerSecond(100, 100_000)).toBe("—")
    })
  })
})

import { describe, expect, it } from "vitest"
import {
  assessContentQuality,
  getRecommendedThreshold
} from "../content-quality-filter"

describe("Content Quality Filter", () => {
  describe("assessContentQuality", () => {
    it("scores greetings low", () => {
      const result = assessContentQuality("Hi there", "user")
      expect(result.score).toBeLessThan(0.4)
      expect(result.shouldEmbed).toBe(false)
      expect(result.reasons).toContain("casual greeting")
    })

    it("scores technical queries high", () => {
      const result = assessContentQuality(
        "How do I implement a binary search tree in Python?",
        "user"
      )
      expect(result.score).toBeGreaterThan(0.4)
      expect(result.shouldEmbed).toBe(true)
      expect(result.reasons).toContain("technical content")
    })

    it("scores code blocks high", () => {
      const text = "Here is the code:\n```python\nprint('hello')\n```"
      const result = assessContentQuality(text, "assistant")
      expect(result.score).toBeGreaterThan(0.6)
      expect(result.reasons).toContain("contains code block")
    })

    it("penalizes very short questions from user", () => {
      const result = assessContentQuality("really?", "user")
      expect(result.score).toBeLessThan(0.5)
      expect(result.reasons).toContain("short user question")
    })
  })

  describe("getRecommendedThreshold", () => {
    it("increases threshold as storage fills", () => {
      expect(getRecommendedThreshold(100, 1000)).toBe(0.3) // 10% full
      expect(getRecommendedThreshold(600, 1000)).toBe(0.4) // 60% full
      expect(getRecommendedThreshold(950, 1000)).toBe(0.6) // 95% full
    })
  })
})

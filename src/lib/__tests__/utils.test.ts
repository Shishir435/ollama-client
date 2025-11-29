import { describe, expect, it } from "vitest"
import {
  cn,
  formatDuration,
  formatTokensPerSecond,
  markdownToSpeechText,
  normalizeWhitespace,
  normalizeWhitespaceForLLM
} from "../utils"

describe("Utils", () => {
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

  describe("normalizeWhitespace", () => {
    it("should normalize multiple spaces", () => {
      expect(normalizeWhitespace("foo  bar")).toBe("foo bar")
    })

    it("should normalize newlines", () => {
      expect(normalizeWhitespace("foo\n\n\nbar")).toBe("foo\n\nbar")
    })

    it("should trim whitespace", () => {
      expect(normalizeWhitespace("  foo bar  ")).toBe("foo bar")
    })

    it("should handle mixed whitespace", () => {
      expect(normalizeWhitespace("foo \t bar \n baz")).toBe("foo bar\n baz")
    })
  })

  describe("normalizeWhitespaceForLLM", () => {
    it("should normalize line endings", () => {
      expect(normalizeWhitespaceForLLM("foo\r\nbar")).toBe("foo\nbar")
      expect(normalizeWhitespaceForLLM("foo\rbar")).toBe("foo\nbar")
    })

    it("should remove trailing spaces before newlines", () => {
      expect(normalizeWhitespaceForLLM("foo  \nbar")).toBe("foo\nbar")
    })

    it("should limit consecutive newlines", () => {
      expect(normalizeWhitespaceForLLM("foo\n\n\nbar")).toBe("foo\n\nbar")
    })

    it("should remove leading/trailing newlines", () => {
      expect(normalizeWhitespaceForLLM("\nfoo\n")).toBe("foo")
    })

    it("should handle complex mixed whitespace", () => {
      const input = "  foo  \n  bar  \n\n\n  baz  "
      // Expected:
      // "  foo  " -> "foo" (trim start)
      // "  \n" -> "\n" (trailing space removal)
      // "  bar  " -> "bar"
      // "\n\n\n" -> "\n\n"
      // "  baz  " -> "baz" (trim end)
      expect(normalizeWhitespaceForLLM(input)).toBe("foo\nbar\n\nbaz")
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
      // 10 tokens in 1 second (1e9 ns)
      expect(formatTokensPerSecond(10, 1_000_000_000)).toBe("10 t/s")
    })

    it("should handle undefined/zero", () => {
      expect(formatTokensPerSecond(undefined, 100)).toBe("0 t/s")
      expect(formatTokensPerSecond(100, undefined)).toBe("0 t/s")
    })
  })

  describe("markdownToSpeechText", () => {
    it("should remove code blocks", () => {
      expect(markdownToSpeechText("Code: `const x = 1`")).toBe("Code:")
      expect(markdownToSpeechText("Block: ```js\ncode\n```")).toBe("Block:")
    })

    it("should remove formatting symbols", () => {
      expect(markdownToSpeechText("**Bold** *Italic*")).toBe("Bold Italic")
    })

    it("should format links", () => {
      expect(markdownToSpeechText("Click [here](https://example.com)")).toBe("Click here")
    })

    it("should normalize whitespace", () => {
      expect(markdownToSpeechText("  Hello   World  ")).toBe("Hello World")
    })
  })
})

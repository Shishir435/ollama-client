import { describe, expect, it } from "vitest"
import {
  markdownToSpeechText,
  normalizeWhitespace,
  normalizeWhitespaceForLLM
} from "../text-utils"

describe("text-utils", () => {
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
      expect(normalizeWhitespaceForLLM(input)).toBe("foo\nbar\n\nbaz")
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
      expect(markdownToSpeechText("Click [here](https://example.com)")).toBe(
        "Click here"
      )
    })

    it("should normalize whitespace", () => {
      expect(markdownToSpeechText("  Hello   World  ")).toBe("Hello World")
    })
  })
})

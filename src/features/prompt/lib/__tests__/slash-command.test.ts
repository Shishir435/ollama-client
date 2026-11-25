import { describe, expect, it } from "vitest"
import type { PromptTemplate } from "@/types"
import {
  filterSlashTemplates,
  findSlashQuery,
  insertSlashTemplate,
  SLASH_MENU_LIMIT
} from "../slash-command"

const template = (
  title: string,
  extra: Partial<PromptTemplate> = {}
): PromptTemplate =>
  ({
    id: title,
    title,
    userPrompt: `Prompt for ${title}`,
    ...extra
  }) as PromptTemplate

describe("findSlashQuery", () => {
  const caretAtEnd = (value: string) => findSlashQuery(value, value.length)

  it("opens for a slash at the very start", () => {
    expect(caretAtEnd("/")).toEqual({ start: 0, query: "" })
    expect(caretAtEnd("/sum")).toEqual({ start: 0, query: "sum" })
  })

  it("opens for a slash that starts a later line, indented or not", () => {
    expect(caretAtEnd("hello\n/")).toEqual({ start: 6, query: "" })
    expect(caretAtEnd("hello\n  /tr")).toEqual({ start: 8, query: "tr" })
    expect(caretAtEnd("  /x")).toEqual({ start: 2, query: "x" })
  })

  it.each([
    "and/or",
    "https://example.com",
    "a /b",
    "path/to/file",
    "1/2",
    "text then\nmore text/"
  ])("does not open mid-word or mid-line: %s", (value) => {
    expect(caretAtEnd(value)).toBeNull()
  })

  it("closes when the query would contain whitespace", () => {
    expect(caretAtEnd("/summarize this")).toBeNull()
    expect(caretAtEnd("/summarize\t")).toBeNull()
  })

  it("does not open inside a fenced code block", () => {
    expect(caretAtEnd("```js\nconst x = 1\n/")).toBeNull()
    expect(caretAtEnd("~~~\n/etc")).toBeNull()
    expect(caretAtEnd("```\ncode\n```\n/")).toEqual({ start: 13, query: "" })
  })

  it("follows the caret, not the end of the text", () => {
    expect(findSlashQuery("/su later words", 3)).toEqual({
      start: 0,
      query: "su"
    })
    expect(findSlashQuery("/su later words", 0)).toBeNull()
    expect(findSlashQuery("/su", null)).toBeNull()
    expect(findSlashQuery("/su", 99)).toBeNull()
  })
})

describe("filterSlashTemplates", () => {
  const templates = [
    template("Translate", { usageCount: 1, tags: ["language"] }),
    template("Summarize", { usageCount: 9 }),
    template("Rewrite politely", {
      description: "Make it summarized-sounding"
    }),
    template("Explain code", { category: "Dev" })
  ]
  const titles = (query: string) =>
    filterSlashTemplates(templates, query).map((t) => t.title)

  it("offers the most used templates for an empty slash", () => {
    expect(titles("")).toEqual([
      "Summarize",
      "Translate",
      "Explain code",
      "Rewrite politely"
    ])
  })

  it("ranks title prefix first, then tags and category, then description", () => {
    expect(titles("sum")).toEqual(["Summarize", "Rewrite politely"])
    expect(titles("lang")).toEqual(["Translate"])
    expect(titles("dev")).toEqual(["Explain code"])
  })

  it("matches without regard to case", () => {
    expect(titles("TRANS")).toEqual(["Translate"])
  })

  it("returns nothing when nothing matches", () => {
    expect(titles("zzz")).toEqual([])
  })

  it("keeps the list short", () => {
    const many = Array.from({ length: 30 }, (_, i) => template(`T${i}`))
    expect(filterSlashTemplates(many, "")).toHaveLength(SLASH_MENU_LIMIT)
  })
})

describe("insertSlashTemplate", () => {
  it("replaces the token with the prompt and puts the caret after it", () => {
    expect(
      insertSlashTemplate("/sum", { start: 0, query: "sum" }, 4, "Do it")
    ).toEqual({ value: "Do it", caret: 5 })
  })

  it("keeps earlier lines and separates following text from the prompt", () => {
    expect(
      insertSlashTemplate("intro\n/s tail", { start: 6, query: "s" }, 8, "P")
    ).toEqual({ value: "intro\nP tail", caret: 7 })
  })

  it("adds no space when the token ends the text or whitespace follows", () => {
    expect(
      insertSlashTemplate("/s", { start: 0, query: "s" }, 2, "P").value
    ).toBe("P")
    expect(
      insertSlashTemplate("/s\nmore", { start: 0, query: "s" }, 2, "P").value
    ).toBe("P\nmore")
  })
})

import { describe, expect, it } from "vitest"
import {
  hasNonNativeToolCall,
  parseNonNativeToolCalls
} from "../non-native-tool-parser"

describe("parseNonNativeToolCalls", () => {
  it("extracts a single tool call and cleans the text", () => {
    const text =
      'Let me check.\n<tool_call>{"name": "rag_search", "arguments": {"query": "hi"}}</tool_call>'
    const { toolCalls, cleanedText } = parseNonNativeToolCalls(text)
    expect(toolCalls).toEqual([
      { id: "rag_search_0", name: "rag_search", arguments: { query: "hi" } }
    ])
    expect(cleanedText).toBe("Let me check.")
  })

  it("extracts multiple calls in document order with unique ids", () => {
    const text =
      '<tool_call>{"name": "a", "arguments": {"x": 1}}</tool_call>' +
      '<tool_call>{"name": "b", "arguments": {}}</tool_call>'
    const { toolCalls } = parseNonNativeToolCalls(text)
    expect(toolCalls.map((c) => c.id)).toEqual(["a_0", "b_1"])
    expect(toolCalls[1]?.arguments).toEqual({})
  })

  it("tolerates a markdown fence inside the block", () => {
    const text =
      '<tool_call>\n```json\n{"name": "web_search", "arguments": {"q": "x"}}\n```\n</tool_call>'
    const { toolCalls } = parseNonNativeToolCalls(text)
    expect(toolCalls[0]).toEqual({
      id: "web_search_0",
      name: "web_search",
      arguments: { q: "x" }
    })
  })

  it("coerces non-object / missing arguments to {}", () => {
    const text =
      '<tool_call>{"name": "t", "arguments": [1,2]}</tool_call>' +
      '<tool_call>{"name": "u"}</tool_call>'
    const { toolCalls } = parseNonNativeToolCalls(text)
    expect(toolCalls[0]?.arguments).toEqual({})
    expect(toolCalls[1]?.arguments).toEqual({})
  })

  it("skips malformed JSON and nameless blocks but keeps valid ones", () => {
    const text =
      "<tool_call>not json</tool_call>" +
      '<tool_call>{"arguments": {}}</tool_call>' +
      '<tool_call>{"name": "ok", "arguments": {"a": 1}}</tool_call>'
    const { toolCalls } = parseNonNativeToolCalls(text)
    expect(toolCalls).toEqual([{ id: "ok_0", name: "ok", arguments: { a: 1 } }])
  })

  it("returns no calls and the original text when there are none", () => {
    const { toolCalls, cleanedText } = parseNonNativeToolCalls("just an answer")
    expect(toolCalls).toEqual([])
    expect(cleanedText).toBe("just an answer")
  })
})

describe("hasNonNativeToolCall", () => {
  it("detects a complete block and ignores an unclosed one", () => {
    expect(hasNonNativeToolCall("<tool_call>{}</tool_call>")).toBe(true)
    expect(hasNonNativeToolCall("<tool_call>{} (never closed")).toBe(false)
  })

  it("is stateless across repeated calls (lastIndex reset)", () => {
    const t = "<tool_call>{}</tool_call>"
    expect(hasNonNativeToolCall(t)).toBe(true)
    expect(hasNonNativeToolCall(t)).toBe(true)
  })
})

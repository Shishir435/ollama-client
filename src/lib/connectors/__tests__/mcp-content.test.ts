/** @vitest-environment node */
import { describe, expect, it } from "vitest"
import { mapMcpCallResult } from "../mcp/content"
import { SseParser } from "../mcp/sse"

describe("mapMcpCallResult", () => {
  it("keeps text and resources and names media it does not pass on", () => {
    const output = mapMcpCallResult({
      content: [
        { type: "text", text: "Sent." },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        { type: "image", data: "not base64!", mimeType: "image/png" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/svg+xml" },
        { type: "audio", data: "aGVsbG8=", mimeType: "audio/wav" },
        { type: "resource", resource: { uri: "file:///a.txt", text: "body" } },
        { type: "resource_link", uri: "file:///b.txt", name: "b" }
      ],
      isError: false
    })
    expect(output.text.split("\n")).toEqual([
      "Sent.",
      "[image omitted: image/png]",
      "[image omitted: image/png]",
      "[image omitted: image/svg+xml]",
      "[audio omitted]",
      "body",
      "[resource link: b <file:///b.txt>]"
    ])
  })

  it("falls back to structured content and keeps the error flag", () => {
    const output = mapMcpCallResult({
      content: [],
      structuredContent: { count: 2 },
      isError: true
    })
    expect(output).toMatchObject({ text: '{"count":2}', isError: true })
  })

  it("says there was no output rather than returning nothing", () => {
    expect(mapMcpCallResult({}).text).toBe("(no output)")
  })
})

describe("SseParser", () => {
  it("joins multi-line data and survives a CRLF split between chunks", () => {
    const parser = new SseParser()
    expect(parser.push("data: a\r")).toEqual([])
    expect(parser.push("\ndata: b\r\n\r")).toEqual(["a\nb"])
    expect(parser.push("\n: comment\n\nevent: x\ndata:c\n\n")).toEqual(["c"])
  })

  it("flushes a final event that has no trailing blank line", () => {
    const parser = new SseParser()
    expect(parser.push("data: last")).toEqual([])
    expect(parser.end()).toEqual(["last"])
  })
})

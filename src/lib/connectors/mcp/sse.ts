/**
 * Incremental parser for a `text/event-stream` body, enough for MCP's
 * Streamable HTTP responses: `data:` lines joined with newlines, an event
 * dispatched on a blank line, comments and other fields ignored. Chunks may
 * split anywhere, including between `\r` and `\n`.
 */
export class SseParser {
  private buffer = ""
  private data: string[] = []
  private pendingCr = false

  /** Feed decoded text; returns the data payload of every completed event. */
  push(text: string): string[] {
    let input = text
    if (this.pendingCr) {
      this.pendingCr = false
      if (input.startsWith("\n")) input = input.slice(1)
    }
    this.buffer += input
    const events: string[] = []
    for (;;) {
      const match = /\r\n|\n|\r/.exec(this.buffer)
      if (!match) break
      if (match[0] === "\r" && match.index === this.buffer.length - 1) {
        this.pendingCr = true
      }
      const line = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      const event = this.line(line)
      if (event !== null) events.push(event)
    }
    return events
  }

  /** Flush at end of stream: a final event without its blank line still counts. */
  end(): string[] {
    const events: string[] = []
    if (this.buffer) {
      const event = this.line(this.buffer)
      this.buffer = ""
      if (event !== null) events.push(event)
    }
    const last = this.line("")
    if (last !== null) events.push(last)
    return events
  }

  private line(line: string): string | null {
    if (line === "") {
      if (this.data.length === 0) return null
      const payload = this.data.join("\n")
      this.data = []
      return payload
    }
    if (line.startsWith(":")) return null
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    if (field !== "data") return null
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    this.data.push(value)
    return null
  }
}

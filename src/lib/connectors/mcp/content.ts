/** What a `tools/call` result becomes before it reaches the tool loop. */
export interface McpCallOutput {
  text: string
  isError: boolean
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

/**
 * Flatten MCP content parts. Text stays text and embedded resources contribute
 * their text. Images and audio are named, not passed on: the tool loop would
 * hand them to the model as a user message whether or not it can see.
 */
export const mapMcpCallResult = (result: unknown): McpCallOutput => {
  const record = asRecord(result) ?? {}
  const parts = Array.isArray(record.content) ? record.content : []
  const texts: string[] = []

  for (const raw of parts) {
    const part = asRecord(raw)
    if (!part) continue
    switch (part.type) {
      case "text": {
        const text = str(part.text)
        if (text) texts.push(text)
        break
      }
      case "image": {
        const mimeType = str(part.mimeType)
        texts.push(`[image omitted${mimeType ? `: ${mimeType}` : ""}]`)
        break
      }
      case "audio":
        texts.push("[audio omitted]")
        break
      case "resource": {
        const resource = asRecord(part.resource)
        const text = str(resource?.text)
        const uri = str(resource?.uri)
        texts.push(text ?? `[resource${uri ? `: ${uri}` : ""}]`)
        break
      }
      case "resource_link": {
        const uri = str(part.uri)
        const name = str(part.name)
        texts.push(
          `[resource link${name ? `: ${name}` : ""}${uri ? ` <${uri}>` : ""}]`
        )
        break
      }
      default:
        break
    }
  }

  if (texts.length === 0 && record.structuredContent !== undefined) {
    try {
      texts.push(JSON.stringify(record.structuredContent))
    } catch {
      // A cyclic or otherwise unserializable value has nothing to say.
    }
  }

  return {
    text: texts.length > 0 ? texts.join("\n") : "(no output)",
    isError: record.isError === true
  }
}

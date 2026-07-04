import { redactAgentText } from "@/lib/agent-redaction"
import type { AgentRun } from "@/lib/repositories/agent-runs"

const SENSITIVE_KEY =
  /(?:password|passwd|secret|token|authorization|cookie|credential|api[-_]?key|text|value|arguments|args)/i

const redact = (value: unknown, key = ""): unknown => {
  if (SENSITIVE_KEY.test(key)) return "[redacted]"
  if (typeof value === "string") return redactAgentText(value)
  if (Array.isArray(value)) return value.map((entry) => redact(entry))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redact(entryValue, entryKey)
      ])
    )
  }
  return value
}

export const serializeAgentRunLog = (run: AgentRun): string =>
  JSON.stringify(redact(run), null, 2)

export const downloadAgentRunLog = (run: AgentRun): void => {
  const blob = new Blob([serializeAgentRunLog(run)], {
    type: "application/json"
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `agent-run-${run.id}.json`
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

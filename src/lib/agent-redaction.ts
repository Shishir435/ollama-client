export const redactAgentText = (value: string): string =>
  value
    .replace(/value=(?:"[^"]*"|'[^']*'|\S+)/gi, "value=[redacted]")
    .replace(
      /\b(?:password|passwd|secret|token|authorization|cookie|api[-_]?key)\s*[:=]\s*\S+/gi,
      "[redacted]"
    )

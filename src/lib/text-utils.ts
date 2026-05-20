export const normalizeWhitespace = (text: string): string => {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
}

/**
 * Enhanced whitespace normalization specifically for LLM context.
 * More aggressive cleaning for better token efficiency.
 */
export const normalizeWhitespaceForLLM = (text: string): string => {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n /g, "\n")
    .replace(/ \n/g, "\n")
    .replace(/\n+$/g, "")
    .replace(/^\n+/g, "")
    .trim()
}

export const markdownToSpeechText = (markdown: string): string => {
  return markdown
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/[*_~#>[\]()`]/g, "")
    .replace(/\\+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

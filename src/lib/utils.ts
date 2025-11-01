import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export const cn = (...inputs: ClassValue[]) => {
  return twMerge(clsx(inputs))
}

export const normalizeWhitespace = (text: string): string => {
  return text
    .replace(/\s+\n/g, "\n") // Remove trailing spaces before newlines
    .replace(/\n{3,}/g, "\n\n") // Limit consecutive newlines to 2
    .replace(/[ \t]{2,}/g, " ") // Convert multiple spaces/tabs to one space
    .trim()
}

export const formatDuration = (nanoseconds?: number): string => {
  if (!nanoseconds) return "0ms"

  const milliseconds = nanoseconds / 1_000_000
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`
  }

  const seconds = milliseconds / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  const minutes = seconds / 60
  return `${minutes.toFixed(1)}m`
}

export const formatTokensPerSecond = (
  tokens?: number,
  duration?: number
): string => {
  if (!tokens || !duration) return "0 t/s"

  const seconds = duration / 1_000_000_000 // Convert nanoseconds to seconds
  const tokensPerSecond = tokens / seconds

  return `${Math.round(tokensPerSecond)} t/s`
}

export const markdownToSpeechText = (markdown: string): string => {
  return markdown
    .replace(/`{1,3}[^`]*`{1,3}/g, "") // remove inline/code blocks
    .replace(/[*_~#>[\]()`]/g, "") // remove symbols
    .replace(/\\+/g, "") // remove backslashes
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1") // format links: [text](url) → text
    .replace(/\s+/g, " ") // normalize whitespace
    .trim()
}

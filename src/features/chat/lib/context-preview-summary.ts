import type { FileProcessingState } from "@/lib/file-processors/types"

export const getQuotedSelectionPreview = (input: string) => {
  const quotedLines = input
    .split("\n")
    .filter((line) => line.startsWith("> "))
    .map((line) => line.slice(2))

  const text = quotedLines.join("\n").trim()
  if (!text) return null

  return {
    text,
    charCount: text.length
  }
}

export const getFileContextPreview = (
  processingStates: FileProcessingState[]
) => {
  const successCount = processingStates.filter(
    (state) => state.status === "success" && state.result
  ).length
  const processingCount = processingStates.filter(
    (state) => state.status === "processing"
  ).length
  const errorCount = processingStates.filter(
    (state) => state.status === "error"
  ).length
  const charCount = processingStates.reduce((total, state) => {
    return (
      total + (state.status === "success" ? state.result?.text.length || 0 : 0)
    )
  }, 0)

  return {
    totalCount: processingStates.length,
    successCount,
    processingCount,
    errorCount,
    charCount
  }
}

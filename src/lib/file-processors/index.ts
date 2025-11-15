import { TextProcessor } from "@/features/file-upload/processors/text-processor"
import type { FileProcessor, ProcessedFile } from "./types"

const processors: FileProcessor[] = [new TextProcessor()]

export function getProcessor(file: File): FileProcessor | null {
  return processors.find((processor) => processor.canProcess(file)) || null
}

export async function processFile(file: File): Promise<ProcessedFile> {
  const processor = getProcessor(file)

  if (!processor) {
    throw new Error(
      `No processor available for file type: ${file.type || file.name}`
    )
  }

  return processor.process(file)
}

export function isFileTypeSupported(file: File): boolean {
  return processors.some((processor) => processor.canProcess(file))
}

export function getSupportedExtensions(): string[] {
  return [
    ".txt",
    ".md",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".json",
    ".css",
    ".html",
    ".xml",
    ".yaml",
    ".yml"
  ]
}

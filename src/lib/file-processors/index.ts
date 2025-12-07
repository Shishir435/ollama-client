import { CsvProcessor } from "@/features/file-upload/processors/csv-processor"
import { DocxProcessor } from "@/features/file-upload/processors/docx-processor"
import { HtmlProcessor } from "@/features/file-upload/processors/html-processor"
import { PdfProcessor } from "@/features/file-upload/processors/pdf-processor"
import { TextProcessor } from "@/features/file-upload/processors/text-processor"
import type { FileProcessor, ProcessedFile } from "./types"

// Processor priority order: specific formats first, then generic text
const processors: FileProcessor[] = [
  new PdfProcessor(), // PDF has highest priority
  new DocxProcessor(), // DOCX second
  new CsvProcessor(), // CSV third (before text to handle .csv files)
  new HtmlProcessor(), // HTML fourth (before text to handle .html files)
  new TextProcessor() // Text processor is fallback
]

/**
 * Get the appropriate processor for a file
 */
export function getProcessor(file: File): FileProcessor | null {
  console.log(
    "🟡🟡🟡 [getProcessor] Finding processor for:",
    file.name,
    "type:",
    file.type
  )

  for (const processor of processors) {
    const processorName = processor.constructor.name
    console.log("🟡 [getProcessor] Checking:", processorName)

    const canProcess = processor.canProcess(file)
    console.log("🟡 [getProcessor]", processorName, "can process?", canProcess)

    if (canProcess) {
      console.log("✅ [getProcessor] Using processor:", processorName)
      return processor
    }
  }

  console.log("❌ [getProcessor] No processor found for:", file.name)
  return null
}

/**
 * Process a file using the appropriate processor
 */
export async function processFile(file: File): Promise<ProcessedFile> {
  console.log(
    "🔵🔵🔵 [processFile] Starting to process:",
    file.name,
    "type:",
    file.type,
    "size:",
    file.size
  )

  const processor = getProcessor(file)

  if (!processor) {
    console.error(
      "🔴 [processFile] No processor available for:",
      file.name,
      file.type
    )
    throw new Error(
      `No processor available for file type: ${file.type || file.name}`
    )
  }

  console.log("🔵 [processFile] Processing with:", processor.constructor.name)
  const result = await processor.process(file)
  console.log("🔵 [processFile] Successfully processed:", file.name)
  return result
}

export function isFileTypeSupported(file: File): boolean {
  return processors.some((processor) => processor.canProcess(file))
}

export function getSupportedExtensions(): string[] {
  return [
    "*", // Text files (fallback)
    ".pdf", // PDF
    ".docx", // Word
    ".csv", // CSV
    ".tsv", // Tab-separated
    ".html", // HTML
    ".htm" // HTML
  ]
}

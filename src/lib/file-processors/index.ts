import { CsvProcessor } from "@/features/file-upload/processors/csv-processor"
import { DocxProcessor } from "@/features/file-upload/processors/docx-processor"
import { HtmlProcessor } from "@/features/file-upload/processors/html-processor"
import { PdfProcessor } from "@/features/file-upload/processors/pdf-processor"
import { TextProcessor } from "@/features/file-upload/processors/text-processor"
import { logger } from "@/lib/logger"
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
  logger.verbose("Finding processor for file", "getProcessor", {
    fileName: file.name,
    fileType: file.type
  })

  for (const processor of processors) {
    const processorName = processor.constructor.name
    const canProcess = processor.canProcess(file)

    logger.verbose("Checking processor", "getProcessor", {
      processorName,
      canProcess
    })

    if (canProcess) {
      return processor
    }
  }

  logger.warn("No processor found for file", "getProcessor", {
    fileName: file.name
  })
  return null
}

/**
 * Process a file using the appropriate processor
 */
export async function processFile(file: File): Promise<ProcessedFile> {
  logger.info("Starting file processing", "processFile", {
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size
  })

  const processor = getProcessor(file)

  if (!processor) {
    logger.error("No processor available for file", "processFile", {
      fileName: file.name,
      fileType: file.type
    })
    throw new Error(
      `No processor available for file type: ${file.type || file.name}`
    )
  }

  logger.verbose("Processing with processor", "processFile", {
    processorName: processor.constructor.name
  })
  const result = await processor.process(file)
  logger.info("Successfully processed file", "processFile", {
    fileName: file.name
  })
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

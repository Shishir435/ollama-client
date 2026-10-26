import { pdfTextFromPages } from "@/application/file-processing/processors/pdf-processor"
import type { ProcessedFile } from "@/lib/file-processors/types"
import type { DurableProcessedFile } from "./ingestion-payload-db"

/** A processed file as the durable store holds it: pages stand in for their own text. */
export const toDurableProcessedFile = (
  file: ProcessedFile,
  identity: { fileId: string; knowledgeSetId: string }
): DurableProcessedFile => {
  const { text, ...rest } = file
  return {
    ...rest,
    ...(file.pages?.length ? {} : { text }),
    metadata: { ...file.metadata, ...identity }
  }
}

/** The flat text of a durable file, whether it was stored or left to its pages. */
export const durableFileText = (file: DurableProcessedFile): string =>
  file.text ?? pdfTextFromPages(file.pages ?? [])

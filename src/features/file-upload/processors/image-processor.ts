import { DEFAULT_FILE_UPLOAD_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import type { FileProcessor, ProcessedFile } from "@/lib/file-processors/types"
import { processImageForOCR } from "@/lib/ocr/ocr"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { FileUploadConfig } from "@/types"

export class ImageProcessor implements FileProcessor {
  canProcess(file: File): boolean {
    return file.type.startsWith("image/")
  }

  async process(file: File): Promise<ProcessedFile> {
    const config = await this.getConfig()
    if (!config.enableOcr) {
      throw new Error(
        "OCR is disabled. Enable OCR in settings to process images."
      )
    }

    const start =
      typeof performance === "undefined" ? Date.now() : performance.now()
    const dataUrl = await this.fileToDataUrl(file)
    const result = await processImageForOCR(dataUrl, {
      language: config.ocrLanguage
    })
    const end =
      typeof performance === "undefined" ? Date.now() : performance.now()
    const processingTime = Math.round(end - start)

    const text = result.text?.trim()
      ? result.text
      : "(No text content detected in image)"

    return {
      text,
      metadata: {
        fileName: file.name,
        fileType: file.type || "image/*",
        fileSize: file.size,
        processedAt: Date.now(),
        ocrLanguage: result.language,
        ocrConfidence: result.confidence,
        processingTime
      }
    }
  }

  private async getConfig(): Promise<FileUploadConfig> {
    const stored = await plasmoGlobalStorage.get<FileUploadConfig>(
      STORAGE_KEYS.FILE_UPLOAD.CONFIG
    )
    return {
      ...DEFAULT_FILE_UPLOAD_CONFIG,
      ...stored
    }
  }

  private async fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
}

import { createWorker } from "pa-tesseract.js"
import { browser } from "@/lib/browser-api"
import { DEFAULT_FILE_UPLOAD_CONFIG, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { FileUploadConfig } from "@/types"
import { getDefaultOcrLanguage } from "./ocr-language"

export interface OcrResult {
  text: string
  confidence?: number
  language: string
}

const getFileUploadConfig = async (): Promise<FileUploadConfig> => {
  const stored = await plasmoGlobalStorage.get<FileUploadConfig>(
    STORAGE_KEYS.FILE_UPLOAD.CONFIG
  )
  return {
    ...DEFAULT_FILE_UPLOAD_CONFIG,
    ...stored
  }
}

const resolveOcrLanguage = async (override?: string): Promise<string> => {
  if (override && override.length > 0) {
    return override
  }

  const config = await getFileUploadConfig()
  if (config.ocrLanguage && config.ocrLanguage.length > 0) {
    return config.ocrLanguage
  }

  return getDefaultOcrLanguage()
}

export const processImageForOCR = async (
  imageData: string,
  options?: {
    language?: string
  }
): Promise<OcrResult> => {
  const language = await resolveOcrLanguage(options?.language)

  const workerPath = browser.runtime.getURL("ocr/worker.min.js")
  const corePath = browser.runtime.getURL("ocr/tesseract-core-simd.js")
  const langPath = browser.runtime.getURL("ocr/lang/")

  try {
    const worker = await createWorker(language, undefined, {
      workerPath,
      workerBlobURL: false,
      corePath,
      langPath,
      gzip: false,
      errorHandler: (error) => {
        logger.error("OCR worker error", "processImageForOCR", {
          error,
          language
        })
      }
    })

    const result = await worker.recognize(imageData)

    await worker.terminate()

    return {
      text: result?.data?.text || "",
      confidence: result?.data?.confidence,
      language
    }
  } catch (error) {
    logger.error("OCR failed", "processImageForOCR", { error, language })
    return {
      text: "",
      confidence: undefined,
      language
    }
  }
}

export const isOcrEnabled = async (): Promise<boolean> => {
  const config = await getFileUploadConfig()
  return config.enableOcr ?? false
}

export const getOcrLanguageToUse = async (): Promise<string> => {
  return resolveOcrLanguage()
}

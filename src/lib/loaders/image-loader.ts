import { processImageForOCR } from "../ocr/ocr-processor"
import type {
  DocumentLoader,
  ImageLoaderOptions,
  LoaderDocument
} from "./types"

/**
 * Image Document Loader
 * Extracts text from images using OCR
 */
export class ImageLoader implements DocumentLoader {
  private url: string
  private name: string
  private language?: string

  constructor({ url, name, language }: ImageLoaderOptions) {
    this.url = url
    this.name = name
    this.language = language
  }

  /**
   * Load image and extract text via OCR
   */
  async load(): Promise<LoaderDocument[]> {
    try {
      console.log(`[ImageLoader] Starting OCR for image: ${this.name}`)
      console.log(`[ImageLoader] Image data URL length: ${this.url.length}`)
      console.log(`[ImageLoader] Language: ${this.language || "default"}`)
      console.log(`[ImageLoader] Processing image: ${this.name}`)

      // Process image with OCR
      const result = await processImageForOCR(this.url, this.language)

      console.log(
        `[ImageLoader] OCR result - text length: ${result.text.length}, confidence: ${result.confidence}`
      )

      if (!result.text || result.text.trim().length === 0) {
        const errorMsg =
          result.confidence === 0
            ? "OCR failed to process the image. Check the browser Console tab (F12) for detailed error logs starting with [OCR]."
            : `No text detected in image (confidence: ${result.confidence}%). The image may not contain readable text, or the quality may be too low.`

        console.warn(`[ImageLoader] ${errorMsg}`)
        console.warn(
          `[ImageLoader] Image size: ${(this.url.length / 1024 / 1024).toFixed(2)} MB (data URL length)`
        )
        throw new Error(errorMsg)
      }

      const metadata = {
        source: this.name,
        type: "image",
        ocrLanguage: result.language,
        ocrConfidence: result.confidence,
        processingTime: result.processingTime
      }

      return [
        {
          pageContent: result.text,
          metadata
        }
      ]
    } catch (error) {
      console.error("[ImageLoader] Error processing image:", error)
      throw error
    }
  }
}

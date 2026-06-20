import { useStorage } from "@plasmohq/storage/hook"
import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import {
  type ImageRejectReason,
  useImageAttachments
} from "@/features/chat/hooks/use-image-attachments"
import { captureVisibleTabImage } from "@/features/chat/lib/capture-screenshot"
import { useFileUpload } from "@/features/file-upload/hooks/use-file-upload"
import { useSelectedModelCapabilities } from "@/features/model/hooks/use-selected-model-capabilities"
import { useToast } from "@/hooks/use-toast"
import { DEFAULT_MAX_IMAGE_SIZE_MB, STORAGE_KEYS } from "@/lib/constants"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ImageAttachment } from "@/types"

export const useChatInputAttachments = () => {
  const { t } = useTranslation()
  const { toast } = useToast()

  const {
    processFiles,
    processingStates,
    clearProcessingState,
    clearAllProcessingStates
  } = useFileUpload({
    onError: (error) => {
      logger.error("File processing error", "ChatInputBox", { error })
      toast({
        variant: "destructive",
        title: "File Upload Failed",
        description: error.message || "Failed to process file"
      })
    }
  })

  const { capabilities, isResolving: capabilitiesResolving } =
    useSelectedModelCapabilities()
  const visionSupported = capabilities?.vision ?? false
  const visionUnsupported = !visionSupported && !capabilitiesResolving

  const [maxImageSizeMb] = useStorage<number>(
    {
      key: STORAGE_KEYS.IMAGES.MAX_SIZE_MB,
      instance: plasmoGlobalStorage
    },
    DEFAULT_MAX_IMAGE_SIZE_MB
  )

  const handleImageReject = useCallback(
    (reason: ImageRejectReason, file: File) => {
      const description =
        reason === "size"
          ? t("chat.input.images.too_large", {
              name: file.name,
              max: maxImageSizeMb || DEFAULT_MAX_IMAGE_SIZE_MB
            })
          : reason === "heic"
            ? t("chat.input.images.heic_unsupported", { name: file.name })
            : t("chat.input.images.unsupported_type", { name: file.name })
      toast({ variant: "destructive", description })
    },
    [t, toast, maxImageSizeMb]
  )

  const {
    images,
    addFiles: addImageFiles,
    fileToAttachment,
    remove: removeImage,
    clear: clearImages
  } = useImageAttachments({
    maxSizeBytes: (maxImageSizeMb || DEFAULT_MAX_IMAGE_SIZE_MB) * 1024 * 1024,
    onReject: handleImageReject
  })

  const handleImageFiles = useCallback(
    (imageFiles: File[]) => {
      if (imageFiles.length === 0) return
      if (visionUnsupported) {
        toast({
          variant: "destructive",
          description: t("chat.input.images.model_unsupported")
        })
        return
      }
      void addImageFiles(imageFiles)
    },
    [visionUnsupported, addImageFiles, toast, t]
  )

  const captureScreenshot = useCallback(async () => {
    if (visionUnsupported) {
      toast({
        variant: "destructive",
        description: t("chat.input.images.model_unsupported")
      })
      return
    }
    try {
      const file = await captureVisibleTabImage()
      void addImageFiles([file])
    } catch (error) {
      logger.warn("Screenshot capture failed", "ChatInputBox", { error })
      toast({
        variant: "destructive",
        description: t("chat.input.images.screenshot_failed")
      })
    }
  }, [visionUnsupported, addImageFiles, toast, t])

  // For the auto-attach-on-send path: capture + build an attachment without
  // staging it, and stay silent on failure (no toast spam on every send).
  const captureScreenshotAttachment =
    useCallback(async (): Promise<ImageAttachment | null> => {
      if (visionUnsupported) return null
      try {
        const file = await captureVisibleTabImage()
        // notify=false: silent auto-send path, no reject toasts.
        return await fileToAttachment(file, false)
      } catch (error) {
        logger.warn("Auto screenshot capture failed", "ChatInputBox", { error })
        return null
      }
    }, [visionUnsupported, fileToAttachment])

  const successfulFiles = processingStates
    .filter(
      (state): state is typeof state & { result: ProcessedFile } =>
        state.status === "success" && state.result !== undefined
    )
    .map((state) => state.result)

  return {
    processFiles,
    processingStates,
    successfulFiles,
    clearProcessingState,
    clearAllProcessingStates,
    images,
    handleImageFiles,
    captureScreenshot,
    captureScreenshotAttachment,
    visionUnsupported,
    removeImage,
    clearImages
  }
}

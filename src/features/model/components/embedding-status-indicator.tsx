import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useOllamaPull } from "@/features/model/hooks/use-ollama-pull"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_MODEL,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { Database, Download, Loader2, RefreshCw } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ModelCheckResponse } from "@/types"

export const EmbeddingStatusIndicator = () => {
  const [selectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_MODEL
  )

  const modelName = selectedModel || DEFAULT_EMBEDDING_MODEL

  const [isChecking, setIsChecking] = useState(false)
  const [modelExists, setModelExists] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { pullingModel, progress, pullModel } = useOllamaPull()
  const isDownloading = pullingModel === modelName

  const [retryCount, setRetryCount] = useState(0)
  const retryTimerRef = useRef<number | null>(null)
  const MAX_RETRIES = 3

  const checkModel = useCallback(async () => {
    setIsChecking(true)
    setError(null)
    try {
      const resp = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.OLLAMA.CHECK_EMBEDDING_MODEL,
        payload: modelName
      })) as ModelCheckResponse

      if (resp?.success && resp.data && resp.data.exists === true) {
        setModelExists(true)
      } else {
        setModelExists(false)
        if (resp?.error) {
          setError(resp.error.message || "Unknown error")
        }
      }
    } catch (err) {
      setModelExists(false)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsChecking(false)
    }
  }, [modelName])

  useEffect(() => {
    checkModel()
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [checkModel])

  // Auto-retry on error
  useEffect(() => {
    if (error && retryCount < MAX_RETRIES) {
      const backoff = 2 ** retryCount * 1000
      retryTimerRef.current = window.setTimeout(() => {
        setRetryCount((c) => c + 1)
        checkModel()
      }, backoff)
    }
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [error, retryCount, checkModel])

  // Re-check when download completes
  useEffect(() => {
    if (progress === "✅ Success" && !isDownloading) {
      checkModel()
    }
  }, [progress, isDownloading, checkModel])

  const handleRetry = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setError(null)
    setRetryCount(0)
    checkModel()
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    pullModel(modelName)
  }

  const status =
    isChecking || isDownloading
      ? "loading"
      : modelExists === true
        ? "ready"
        : modelExists === false
          ? "missing"
          : "default"

  const statusConfig = {
    loading: {
      icon: <Loader2 className="size-4 animate-spin text-yellow-500" />,
      color: "text-yellow-500",
      text: isDownloading
        ? `Downloading ${modelName}... ${progress || ""}`
        : "Checking status..."
    },
    ready: {
      icon: <Database className="size-4 text-green-600" />,
      color: "text-600",
      text: `Embedding model ready: ${modelName}`
    },
    missing: {
      icon: <Database className="size-4 text-red-500" />,
      color: "text-red-500",
      text: `Model missing: ${modelName}`
    },
    default: {
      icon: <Database className="size-4 text-muted-foreground" />,
      color: "text-muted-foreground",
      text: "Checking embedding model..."
    }
  }

  const { icon, text: statusText, color: statusColor } = statusConfig[status]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          onClick={modelExists === false ? handleDownload : handleRetry}
          className="m-1 rounded-xl border border-border/50 bg-background/50 shadow-sm backdrop-blur-sm transition-all duration-200 hover:bg-accent/50">
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[250px]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className={statusColor}>{statusText}</span>
            {!isChecking && !isDownloading && (
              <RefreshCw
                className="size-4 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={handleRetry}
              />
            )}
          </div>

          {modelExists === false && !isDownloading && !isChecking && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                The embedding model is required for RAG features.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="h-7 text-xs w-full"
                onClick={handleDownload}>
                <Download className="mr-2 h-3 w-3" />
                Download Model
              </Button>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-500 break-words">{error}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

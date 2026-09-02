import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { getCacheStats } from "@/application/embeddings/embedding-service"
import { useConfirmAction } from "@/hooks/use-confirm-action"
import { useToast } from "@/hooks/use-toast"
import {
  clearAllVectors,
  getStorageStats,
  removeDuplicateVectors
} from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"

export type EmbeddingMaintenanceAction =
  | "removeDuplicates"
  | "clearChat"
  | "clearAll"

export interface UseEmbeddingStorageMaintenanceOptions {
  onStoreChanged: () => Promise<void> | void
}

/** Loads vector-store metrics and owns all destructive maintenance actions. */
export const useEmbeddingStorageMaintenance = ({
  onStoreChanged
}: UseEmbeddingStorageMaintenanceOptions) => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const confirmDialog = useConfirmAction()
  const [storageStats, setStorageStats] = useState<{
    totalVectors: number
    totalSizeMB: number
    byType: Record<string, number>
  } | null>(null)
  const [cacheStats, setCacheStats] = useState<{
    size: number
    maxSize: number
  } | null>(null)
  const [isCleaning, setIsCleaning] = useState(false)
  const [confirmAction, setConfirmAction] =
    useState<EmbeddingMaintenanceAction | null>(null)
  const isLoadingStatsRef = useRef(false)

  const loadStats = useCallback(async () => {
    if (isLoadingStatsRef.current) return
    isLoadingStatsRef.current = true
    try {
      const result = await Promise.allSettled([getStorageStats()])
      if (result[0].status === "fulfilled") {
        setStorageStats(result[0].value)
      }
      setCacheStats(getCacheStats())
    } catch (error) {
      logger.error(
        "Failed to load storage stats",
        "useEmbeddingStorageMaintenance",
        { error }
      )
    } finally {
      isLoadingStatsRef.current = false
    }
  }, [])

  useEffect(() => {
    loadStats()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") loadStats()
    }, 10_000)
    return () => clearInterval(interval)
  }, [loadStats])

  const refresh = useCallback(async () => {
    await Promise.all([loadStats(), onStoreChanged()])
  }, [loadStats, onStoreChanged])

  const runMaintenance = useCallback(
    async (action: EmbeddingMaintenanceAction) => {
      setIsCleaning(true)
      try {
        if (action === "removeDuplicates") {
          const { deleted, kept } = await removeDuplicateVectors()
          toast({
            title: t(
              "model.embedding_config.database_management.remove_duplicates_success",
              { deleted, kept }
            )
          })
        } else if (action === "clearChat") {
          const deleted = await clearAllVectors("chat")
          toast({
            title: t(
              "model.embedding_config.database_management.clear_chat_success",
              { count: deleted }
            )
          })
        } else {
          await clearAllVectors()
          toast({
            title: t(
              "model.embedding_config.database_management.clear_all_success"
            )
          })
        }
        await refresh()
      } catch (error) {
        const messageKey =
          action === "removeDuplicates"
            ? "model.embedding_config.database_management.remove_duplicates_error"
            : action === "clearChat"
              ? "model.embedding_config.database_management.clear_chat_error"
              : "model.embedding_config.database_management.clear_all_error"
        logger.error(
          `Failed to run embedding maintenance action: ${action}`,
          "useEmbeddingStorageMaintenance",
          { error }
        )
        toast({ title: t(messageKey), variant: "destructive" })
      } finally {
        setIsCleaning(false)
      }
    },
    [refresh, t, toast]
  )

  const openConfirm = useCallback(
    (action: EmbeddingMaintenanceAction) => {
      setConfirmAction(action)
      confirmDialog.openDialog()
    },
    [confirmDialog.openDialog]
  )

  const closeConfirm = useCallback(() => {
    confirmDialog.closeDialog()
    setConfirmAction(null)
  }, [confirmDialog.closeDialog])

  return {
    storageStats,
    cacheStats,
    isCleaning,
    confirmAction,
    confirmOpen: confirmDialog.open,
    loadStats,
    openConfirm,
    closeConfirm,
    runMaintenance
  }
}

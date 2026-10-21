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
  // Preserve manual callbacks around external storage reads and confirmed mutations.
  "use no memo"

  const { t } = useTranslation()
  const { toast } = useToast()
  const { open: confirmOpen, openDialog, closeDialog } = useConfirmAction()
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
  const statsRequestIdRef = useRef(0)

  const readStats = useCallback(async () => {
    const [result] = await Promise.allSettled([getStorageStats()])
    if (result.status !== "fulfilled") return null
    return { storage: result.value, cache: getCacheStats() }
  }, [])

  const applyStats = useCallback(
    (next: Awaited<ReturnType<typeof readStats>>) => {
      if (!next) return
      setStorageStats(next.storage)
      setCacheStats(next.cache)
    },
    []
  )

  const loadStats = useCallback(async () => {
    const requestId = ++statsRequestIdRef.current
    try {
      const next = await readStats()
      if (requestId === statsRequestIdRef.current) applyStats(next)
    } catch (error) {
      logger.error(
        "Failed to load storage stats",
        "useEmbeddingStorageMaintenance",
        { error }
      )
    }
  }, [applyStats, readStats])

  useEffect(() => {
    void loadStats()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") loadStats()
    }, 10_000)
    return () => {
      statsRequestIdRef.current += 1
      clearInterval(interval)
    }
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
      openDialog()
    },
    [openDialog]
  )

  const closeConfirm = useCallback(() => {
    closeDialog()
    setConfirmAction(null)
  }, [closeDialog])

  return {
    storageStats,
    cacheStats,
    isCleaning,
    confirmAction,
    confirmOpen,
    loadStats,
    openConfirm,
    closeConfirm,
    runMaintenance
  }
}

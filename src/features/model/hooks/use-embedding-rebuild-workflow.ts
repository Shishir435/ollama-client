import { useCallback, useState } from "react"
import { useEmbeddingDimensionStats } from "./use-embedding-dimension-stats"
import { useEmbeddingRebuild } from "./use-embedding-rebuild"

export interface PendingEmbeddingModel {
  model: string
  providerId: string
}

export interface UseEmbeddingRebuildWorkflowOptions {
  memoryEnabled: boolean
  applyModelChange: (model: string, providerId: string) => void
}

/** Owns rebuild status and the two confirmation flows on the embeddings page. */
export const useEmbeddingRebuildWorkflow = ({
  memoryEnabled,
  applyModelChange
}: UseEmbeddingRebuildWorkflowOptions) => {
  // Preserve manual callback memoization around the external rebuild workflow.
  "use no memo"

  const { stats, refresh } = useEmbeddingDimensionStats()
  const rebuildState = useEmbeddingRebuild({
    memoryEnabled,
    onStoreChanged: refresh
  })
  const { rebuild } = rebuildState
  const [confirmRebuildOpen, setConfirmRebuildOpen] = useState(false)
  const [pendingModel, setPendingModel] =
    useState<PendingEmbeddingModel | null>(null)

  const requestModelChange = useCallback(
    (model: string, providerId: string) => {
      setPendingModel({ model, providerId })
    },
    []
  )

  const closeModelChange = useCallback(() => setPendingModel(null), [])

  const switchModel = useCallback(() => {
    if (!pendingModel) return
    applyModelChange(pendingModel.model, pendingModel.providerId)
    setPendingModel(null)
  }, [applyModelChange, pendingModel])

  const switchModelAndRebuild = useCallback(async () => {
    if (!pendingModel) return
    applyModelChange(pendingModel.model, pendingModel.providerId)
    setPendingModel(null)
    await rebuild()
  }, [applyModelChange, pendingModel, rebuild])

  return {
    ...rebuildState,
    dimensionStats: stats,
    refreshDimensionStats: refresh,
    confirmRebuildOpen,
    setConfirmRebuildOpen,
    modelChangeOpen: pendingModel !== null,
    setModelChangeOpen: (open: boolean) => {
      if (!open) closeModelChange()
    },
    requestModelChange,
    switchModel,
    switchModelAndRebuild
  }
}

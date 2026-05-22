import { useTranslation } from "react-i18next"

import { StatusAlert } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type {
  EmbeddingDimensionStats,
  UseEmbeddingDimensionStatsResult
} from "@/features/model/hooks/use-embedding-dimension-stats"
import type { RebuildProgress } from "@/features/model/hooks/use-embedding-rebuild"
import { AlertTriangle, RefreshCw } from "@/lib/lucide-icon"

const stripStats = (
  stats: UseEmbeddingDimensionStatsResult["stats"]
): EmbeddingDimensionStats | null => stats

const buildDimensionSummary = (
  stats: EmbeddingDimensionStats | null
): string =>
  stats
    ? Object.entries(stats.byDimension)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([dimension, count]) => `${dimension}d (${count})`)
        .join(", ")
    : ""

export interface EmbeddingHealthAlertProps {
  stats: UseEmbeddingDimensionStatsResult["stats"]
  memoryEnabled: boolean
  isRebuilding: boolean
  rebuildProgress: RebuildProgress | null
  onRebuildRequest: () => void
}

/**
 * Banner that shows when the vector store has more than one embedding
 * dimension co-existing (almost always a sign of an in-progress
 * mid-migration to a different embedding model). Lets the user kick
 * off a full rebuild and shows progress during it.
 *
 * Returns `null` when the store is healthy or empty — no UI cost.
 */
export const EmbeddingHealthAlert = ({
  stats,
  memoryEnabled,
  isRebuilding,
  rebuildProgress,
  onRebuildRequest
}: EmbeddingHealthAlertProps) => {
  const { t } = useTranslation()

  const concrete = stripStats(stats)
  const showMixedDimensions =
    !!concrete?.mixedDimensions && (concrete?.totalVectors ?? 0) > 0
  if (!showMixedDimensions) return null

  const dimensionSummary = buildDimensionSummary(concrete)
  const rebuildPercentage =
    rebuildProgress && rebuildProgress.total > 0
      ? (rebuildProgress.current / rebuildProgress.total) * 100
      : 0

  return (
    <div className="space-y-3">
      <StatusAlert
        variant="warning"
        icon={AlertTriangle}
        title={t("settings.context.embedding_health.title")}
        description={
          <div className="space-y-1">
            <p>
              {t("settings.context.embedding_health.description", {
                dimensions: dimensionSummary
              })}
            </p>
            <p>{t("settings.context.embedding_health.note")}</p>
            {!memoryEnabled && (
              <p>{t("settings.context.embedding_health.memory_disabled")}</p>
            )}
          </div>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={onRebuildRequest}
            disabled={isRebuilding}>
            {isRebuilding ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                {t("settings.context.embedding_health.action_rebuilding")}
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("settings.context.embedding_health.action")}
              </>
            )}
          </Button>
        }
      />

      {isRebuilding && rebuildProgress && rebuildProgress.total > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {t("settings.context.embedding_health.progress", {
                current: rebuildProgress.current,
                total: rebuildProgress.total
              })}
            </span>
            <span>{Math.round(rebuildPercentage)}%</span>
          </div>
          <Progress value={rebuildPercentage} />
        </div>
      )}
    </div>
  )
}

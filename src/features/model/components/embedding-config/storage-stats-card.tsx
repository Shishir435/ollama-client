import { Database } from "lucide-react"
import { useTranslation } from "react-i18next"

import { MetricTile } from "@/components/feedback"
import { DenseFormGrid } from "@/components/layout"
import { SettingsCard } from "@/components/settings"

export interface StorageStatsCardProps {
  storageStats: {
    totalVectors: number
    totalSizeMB: number
    byType: Record<string, number>
  }
  cacheStats: {
    size: number
    maxSize: number
  } | null
}

export const StorageStatsCard = ({
  storageStats,
  cacheStats
}: StorageStatsCardProps) => {
  const { t } = useTranslation()

  return (
    <SettingsCard
      icon={Database}
      title={t("model.embedding_config.storage_stats_title")}
      description={t(
        "model.embedding_config.storage_stats_description",
        "Current vector storage usage statistics"
      )}>
      <DenseFormGrid>
        <MetricTile
          label={t("model.embedding_config.total_vectors")}
          value={storageStats.totalVectors}
        />
        <MetricTile
          label={t("model.embedding_config.storage_used")}
          value={`${storageStats.totalSizeMB.toFixed(2)} MB`}
        />
      </DenseFormGrid>
      {cacheStats && (
        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {t("model.embedding_config.cache")}
          </p>
          <p className="text-sm">
            {t("model.embedding_config.cache_entries", {
              size: cacheStats.size,
              maxSize: cacheStats.maxSize
            })}
          </p>
        </div>
      )}
    </SettingsCard>
  )
}

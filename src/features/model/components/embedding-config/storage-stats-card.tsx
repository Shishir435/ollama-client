import { Database } from "lucide-react"
import { useTranslation } from "react-i18next"

import { SettingsCard } from "@/components/settings"

interface StorageStatsCardProps {
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
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {t("model.embedding_config.total_vectors")}
          </p>
          <p className="text-2xl font-bold">{storageStats.totalVectors}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">
            {t("model.embedding_config.storage_used")}
          </p>
          <p className="text-2xl font-bold">
            {storageStats.totalSizeMB.toFixed(2)} MB
          </p>
        </div>
      </div>
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

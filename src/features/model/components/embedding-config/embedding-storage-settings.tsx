import { useTranslation } from "react-i18next"

import { TwoColumnGrid } from "@/components/layout"
import { ConfirmActionDialog } from "@/components/settings"
import { useEmbeddingStorageMaintenance } from "@/features/model/hooks/use-embedding-storage-maintenance"
import type { EmbeddingConfig } from "@/lib/constants"

import { EmbeddingIndexControls } from "../embedding-index-controls"
import { DatabaseManagementCard } from "./database-management-card"
import { EmbeddingLimitsConfig } from "./embedding-limits-config"
import { StorageStatsCard } from "./storage-stats-card"

export interface EmbeddingStorageSettingsProps {
  config: EmbeddingConfig
  updateConfig: (updates: Partial<EmbeddingConfig>) => void
  isRebuilding: boolean
  onStoreChanged: () => Promise<void> | void
}

/** Vector statistics, limits, index controls, and destructive maintenance UI. */
export const EmbeddingStorageSettings = ({
  config,
  updateConfig,
  isRebuilding,
  onStoreChanged
}: EmbeddingStorageSettingsProps) => {
  const { t } = useTranslation()
  const maintenance = useEmbeddingStorageMaintenance({ onStoreChanged })

  const confirmConfig = (() => {
    switch (maintenance.confirmAction) {
      case "removeDuplicates":
        return {
          title: t(
            "model.embedding_config.database_management.remove_duplicates_confirm"
          ),
          confirmLabel: t("model.embedding_config.remove_duplicates_button")
        }
      case "clearChat":
        return {
          title: t(
            "model.embedding_config.database_management.clear_chat_confirm"
          ),
          confirmLabel: t("model.embedding_config.clear_chat_button")
        }
      case "clearAll":
        return {
          title: t(
            "model.embedding_config.database_management.clear_all_confirm"
          ),
          confirmLabel: t("model.embedding_config.clear_all_button")
        }
      default:
        return null
    }
  })()

  return (
    <>
      {maintenance.storageStats && (
        <StorageStatsCard
          storageStats={maintenance.storageStats}
          cacheStats={maintenance.cacheStats}
        />
      )}
      <TwoColumnGrid>
        <DatabaseManagementCard
          onRemoveDuplicates={() => maintenance.openConfirm("removeDuplicates")}
          onClearChat={() => maintenance.openConfirm("clearChat")}
          onClearAll={() => maintenance.openConfirm("clearAll")}
          isCleaning={maintenance.isCleaning || isRebuilding}
          hasVectors={!!maintenance.storageStats?.totalVectors}
          hasChatVectors={!!maintenance.storageStats?.byType?.chat}
        />
        <EmbeddingLimitsConfig config={config} updateConfig={updateConfig} />
      </TwoColumnGrid>
      <EmbeddingIndexControls />
      <ConfirmActionDialog
        open={maintenance.confirmOpen}
        onOpenChange={(open) => {
          if (!open) maintenance.closeConfirm()
        }}
        title={confirmConfig?.title || ""}
        confirmLabel={confirmConfig?.confirmLabel || t("common.save")}
        onConfirm={async () => {
          const action = maintenance.confirmAction
          if (!action) return
          maintenance.closeConfirm()
          await maintenance.runMaintenance(action)
        }}
      />
    </>
  )
}

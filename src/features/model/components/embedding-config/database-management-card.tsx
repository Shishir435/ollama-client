import { Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { SettingsCard } from "@/components/settings"
import { Button } from "@/components/ui/button"

interface DatabaseManagementCardProps {
  onRemoveDuplicates: () => void
  onClearChat: () => void
  onClearAll: () => void
  isCleaning: boolean
  hasVectors: boolean
  hasChatVectors: boolean
}

export const DatabaseManagementCard = ({
  onRemoveDuplicates,
  onClearChat,
  onClearAll,
  isCleaning,
  hasVectors,
  hasChatVectors
}: DatabaseManagementCardProps) => {
  const { t } = useTranslation()

  return (
    <SettingsCard
      icon={Trash2}
      title={t("model.embedding_config.database_management_title")}
      description={t("model.embedding_config.database_management_description")}
      contentClassName="space-y-3">
      <div className="space-y-2">
        <Button
          variant="outline"
          onClick={onRemoveDuplicates}
          disabled={isCleaning || !hasVectors}
          className="w-full">
          {t("model.embedding_config.remove_duplicates_button")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("model.embedding_config.remove_duplicates_description")}
        </p>
      </div>

      <div className="space-y-2">
        <Button
          variant="outline"
          onClick={onClearChat}
          disabled={isCleaning || !hasChatVectors}
          className="w-full">
          {t("model.embedding_config.clear_chat_button")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("model.embedding_config.clear_chat_description")}
        </p>
      </div>

      <div className="space-y-2">
        <Button
          variant="destructive"
          onClick={onClearAll}
          disabled={isCleaning || !hasVectors}
          className="w-full">
          {t("model.embedding_config.clear_all_button")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("model.embedding_config.clear_all_description")}
        </p>
      </div>
    </SettingsCard>
  )
}

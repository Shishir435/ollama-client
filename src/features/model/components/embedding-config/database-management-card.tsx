import { Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsRow } from "@/components/settings"
import { Button } from "@/components/ui/button"

export interface DatabaseManagementCardProps {
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
      <SettingsRow
        data-settings-focus="true"
        data-settings-focus-id="remove-duplicate-vectors"
        label={t("model.embedding_config.remove_duplicates_button")}
        description={t("model.embedding_config.remove_duplicates_description")}
        control={
          <Button
            variant="outline"
            onClick={onRemoveDuplicates}
            disabled={isCleaning || !hasVectors}>
            {t("model.embedding_config.remove_duplicates_button")}
          </Button>
        }
      />

      <SettingsRow
        data-settings-focus="true"
        data-settings-focus-id="clear-chat-vectors"
        label={t("model.embedding_config.clear_chat_button")}
        description={t("model.embedding_config.clear_chat_description")}
        control={
          <Button
            variant="outline"
            onClick={onClearChat}
            disabled={isCleaning || !hasChatVectors}>
            {t("model.embedding_config.clear_chat_button")}
          </Button>
        }
      />

      <SettingsRow
        data-settings-focus="true"
        data-settings-focus-id="clear-all-vectors"
        label={t("model.embedding_config.clear_all_button")}
        description={t("model.embedding_config.clear_all_description")}
        control={
          <Button
            variant="destructive"
            onClick={onClearAll}
            disabled={isCleaning || !hasVectors}>
            {t("model.embedding_config.clear_all_button")}
          </Button>
        }
      />
    </SettingsCard>
  )
}

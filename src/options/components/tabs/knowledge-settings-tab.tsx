import { useTranslation } from "react-i18next"
import { SectionStack } from "@/components/layout"
import { AdvancedSection } from "@/components/settings"
import { ContextSettings } from "@/features/context/components/context-settings"
import { EmbeddingSettings } from "@/features/model/components/embedding-settings"

export default function KnowledgeSettingsTab({
  activeFocusId
}: {
  activeFocusId: string | null
}) {
  const { t } = useTranslation()

  return (
    <SectionStack>
      <ContextSettings />
      <AdvancedSection
        title={t("settings.tabs.embeddings")}
        forceOpen={Boolean(activeFocusId)}
        summary={t("model.embedding_config.title")}>
        <EmbeddingSettings />
      </AdvancedSection>
    </SectionStack>
  )
}

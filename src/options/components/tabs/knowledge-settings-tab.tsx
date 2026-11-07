import { useTranslation } from "react-i18next"
import { SectionStack } from "@/components/layout"
import { AdvancedSection } from "@/components/settings"
import { ContextSettings } from "@/features/context/components/context-settings"
import { EmbeddingSettings } from "@/features/model/components/embedding-settings"
import { getSettingsEntrySectionId } from "@/features/settings/settings-registry"

/** Registry sections rendered inside the collapsed "Saved knowledge" group. */
const EMBEDDING_SECTIONS = new Set([
  "embeddings-model",
  "embeddings-generation",
  "embeddings-feedback",
  "embeddings-test",
  "embedding-limits",
  "vector-db"
])

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
        forceOpen={EMBEDDING_SECTIONS.has(
          getSettingsEntrySectionId(activeFocusId) ?? ""
        )}
        summary={t("model.embedding_config.title")}>
        <EmbeddingSettings />
      </AdvancedSection>
    </SectionStack>
  )
}

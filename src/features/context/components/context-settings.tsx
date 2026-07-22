import { useStorage } from "@plasmohq/storage/hook"
import { useTranslation } from "react-i18next"
import { SectionStack, TwoColumnGrid } from "@/components/layout"
import {
  SettingsCard,
  SettingsLevelGate,
  SettingsSwitch
} from "@/components/settings"
import { ChatBackfillPanel } from "@/features/chat/components"
import { GroundingModeSettings } from "@/features/context/components/grounding-mode-settings"
import { PromptContextLimitsSettings } from "@/features/context/components/prompt-context-limits-settings"
import { FileUploadSettings } from "@/features/file-upload/components/file-upload-settings"
import {
  RAGSettings,
  TextSplittingSettings
} from "@/features/knowledge/components"
import { MemorySettings } from "@/features/memory/components/memory-settings"
import { WebSearchSettings } from "@/features/web-search/components/web-search-settings"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  BookOpen,
  Globe,
  Scissors,
  ShieldCheck,
  Upload
} from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

const AutoScreenshotSettings = () => {
  const { t } = useTranslation()
  const [autoScreenshotOnVision, setAutoScreenshotOnVision] =
    useStorage<boolean>(
      {
        key: STORAGE_KEYS.CHAT.AUTO_SCREENSHOT_ON_VISION,
        instance: plasmoGlobalStorage
      },
      false
    )

  return (
    <SettingsSwitch
      id="auto-screenshot-on-vision"
      label={t("chat.input.auto_screenshot")}
      checked={autoScreenshotOnVision}
      onCheckedChange={setAutoScreenshotOnVision}
    />
  )
}

/**
 * Context tab: conversation context, prompt budget, grounding, web search,
 * retrieval, and file/chunking controls.
 *
 * Vector-store/embedding-store controls (storage stats, database maintenance,
 * embedding limits, index rebuild, and the embedding-health alert) live on the
 * Embeddings tab — see `embedding-settings.tsx`. They were relocated there so
 * every embedding/vector-DB concern sits on one screen and the app's most
 * destructive actions are not buried under retrieval tuning.
 */
export const ContextSettings = () => {
  const { t } = useTranslation()

  return (
    <SectionStack>
      <TwoColumnGrid>
        <MemorySettings />
        <SettingsLevelGate settingId="backfill-embeddings">
          <ChatBackfillPanel />
        </SettingsLevelGate>
      </TwoColumnGrid>

      <SettingsLevelGate settingId="max-tab-context-chars">
        <PromptContextLimitsSettings />
      </SettingsLevelGate>

      <SettingsLevelGate settingId="grounded-only-mode">
        <SettingsCard
          icon={ShieldCheck}
          title={t("settings.context.sections.grounding")}
          description={t("settings.context.sections.grounding_description")}>
          <div className="grid gap-4">
            <GroundingModeSettings />
            <AutoScreenshotSettings />
          </div>
        </SettingsCard>
      </SettingsLevelGate>

      <SettingsLevelGate settingId="web-search-enabled">
        <TwoColumnGrid>
          <SettingsCard
            icon={Globe}
            title={t("settings.web_search.title")}
            description={t("settings.web_search.description")}
            badge={t("settings.web_search.beta_badge")}
            badgeTooltip={t("settings.web_search.beta_tooltip")}>
            <WebSearchSettings />
          </SettingsCard>
          <SettingsCard
            icon={BookOpen}
            title={t("model.embedding_config.rag_settings_title")}
            description={t("model.embedding_config.rag_settings_description")}>
            <RAGSettings />
          </SettingsCard>
        </TwoColumnGrid>
      </SettingsLevelGate>

      <TwoColumnGrid>
        <SettingsCard
          icon={Upload}
          title={t("settings.context.file_upload.title")}
          description={t("settings.context.file_upload.description")}>
          <FileUploadSettings />
        </SettingsCard>

        <SettingsLevelGate settingId="chunk-size">
          <SettingsCard
            icon={Scissors}
            title={t("model.embedding_config.chunking_title")}
            description={t("model.embedding_config.chunking_description")}>
            <TextSplittingSettings />
          </SettingsCard>
        </SettingsLevelGate>
      </TwoColumnGrid>
    </SectionStack>
  )
}

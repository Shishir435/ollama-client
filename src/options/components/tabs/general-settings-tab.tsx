import { useTranslation } from "react-i18next"
import { LanguageSelector } from "@/components/language-selector"
import { SectionStack, TwoColumnGrid } from "@/components/layout"
import { PerformanceWarning } from "@/components/performance-warning"
import {
  AdvancedSection,
  PresetPicker,
  SettingsLevelGate
} from "@/components/settings"
import { ChatDisplaySettings } from "@/features/chat/components/chat-display-settings"
import { SpeechSettings } from "@/features/chat/components/speech-settings"
import { PromptTemplateManager } from "@/features/prompt/components/prompt-template-manager"
import { ShortcutsSettings } from "@/options/components/shortcuts-settings"

export default function GeneralSettingsTab({
  activeFocusId
}: {
  activeFocusId: string | null
}) {
  const { t } = useTranslation()

  return (
    <SectionStack>
      <PerformanceWarning />
      <TwoColumnGrid>
        <LanguageSelector />
        <ChatDisplaySettings />
      </TwoColumnGrid>
      <PresetPicker />
      <SettingsLevelGate level="power">
        <AdvancedSection
          title={t("settings.sections.more")}
          forceOpen={Boolean(activeFocusId)}
          summary={`${t("settings.tabs.prompts")} · ${t("settings.tabs.voices")} · ${t("settings.tabs.shortcuts")}`}>
          <SectionStack>
            <SpeechSettings />
            <PromptTemplateManager />
            <ShortcutsSettings />
          </SectionStack>
        </AdvancedSection>
      </SettingsLevelGate>
    </SectionStack>
  )
}

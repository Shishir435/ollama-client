import { lazy, Suspense } from "react"
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
import { ShortcutsSettings } from "@/options/components/shortcuts-settings"

const PromptTemplateManager = lazy(() =>
  import("@/features/prompt/components/prompt-template-manager").then(
    (module) => ({ default: module.PromptTemplateManager })
  )
)

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
          title={t("settings.more_section.title")}
          forceOpen={Boolean(activeFocusId)}>
          <SectionStack>
            <SpeechSettings />
            <Suspense fallback={null}>
              <PromptTemplateManager />
            </Suspense>
            <ShortcutsSettings />
          </SectionStack>
        </AdvancedSection>
      </SettingsLevelGate>
    </SectionStack>
  )
}

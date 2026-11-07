import { lazy, Suspense } from "react"
import { useTranslation } from "react-i18next"
import { LanguageSelector } from "@/components/language-selector"
import { SectionStack, TwoColumnGrid } from "@/components/layout"
import { PerformanceWarning } from "@/components/performance-warning"
import { AdvancedSection, PresetPicker } from "@/components/settings"
import { SettingsLevelGate } from "@/components/settings/settings-disclosure"
import { ChatDisplaySettings } from "@/features/chat/components/chat-display-settings"
import { SpeechSettings } from "@/features/chat/components/speech-settings"
import { getSettingsEntrySectionId } from "@/features/settings/settings-registry"
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
  const targetSection = getSettingsEntrySectionId(activeFocusId)

  return (
    <SectionStack>
      <PerformanceWarning />
      <TwoColumnGrid>
        <LanguageSelector />
        <ChatDisplaySettings />
      </TwoColumnGrid>
      <PresetPicker />
      {/* The prompt library is the user's own content, so it is never hidden. */}
      <Suspense fallback={null}>
        <PromptTemplateManager />
      </Suspense>
      <SettingsLevelGate level="power">
        <AdvancedSection
          title={t("settings.more_section.title")}
          forceOpen={
            targetSection === "voices" || targetSection === "shortcuts"
          }>
          <SectionStack>
            <SpeechSettings />
            <ShortcutsSettings />
          </SectionStack>
        </AdvancedSection>
      </SettingsLevelGate>
    </SectionStack>
  )
}

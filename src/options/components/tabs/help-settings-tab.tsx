import { SectionStack } from "@/components/layout"
import { SocialHandles } from "@/components/social-handles"
import { DiagnosticsSettings } from "@/features/diagnostics/components/diagnostics-settings"
import { Guides } from "@/options/components/guides"

export default function HelpSettingsTab() {
  return (
    <SectionStack>
      <DiagnosticsSettings />
      <Guides />
      <SocialHandles />
    </SectionStack>
  )
}

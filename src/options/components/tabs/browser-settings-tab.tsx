import { SectionStack } from "@/components/layout"
import { ContentExtractionSettings } from "@/features/model/components/content-extraction-settings"

export default function BrowserSettingsTab() {
  return (
    <SectionStack>
      <ContentExtractionSettings />
    </SectionStack>
  )
}

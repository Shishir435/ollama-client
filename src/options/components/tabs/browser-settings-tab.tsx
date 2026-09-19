import { SectionStack } from "@/components/layout"
import { AgentSettings } from "@/features/agent/components/agent-settings"
import { ContentExtractionSettings } from "@/features/model/components/content-extraction-settings"

export default function BrowserSettingsTab() {
  return (
    <SectionStack>
      <ContentExtractionSettings />
      <AgentSettings />
    </SectionStack>
  )
}

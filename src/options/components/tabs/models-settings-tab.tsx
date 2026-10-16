import { SectionStack } from "@/components/layout"
import { ModelSettingsForm } from "@/features/model/components/model-settings-form"
import { ProviderSettings } from "@/features/model/components/provider-settings"

export default function ModelsSettingsTab({
  activeFocusId
}: {
  activeFocusId: string | null
}) {
  return (
    <SectionStack>
      <ProviderSettings activeFocusId={activeFocusId} />
      <ModelSettingsForm />
    </SectionStack>
  )
}

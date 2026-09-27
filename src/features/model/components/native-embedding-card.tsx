import { Brain } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard } from "@/components/settings"
import type { useNativeEmbeddings } from "../hooks/use-native-embeddings"
import { NativeEmbeddingFields } from "./native-embedding-fields"

/** One place to see the active route, choose a server model and switch safely. */
export const NativeEmbeddingCard = ({
  native,
  children
}: {
  native: ReturnType<typeof useNativeEmbeddings>
  children: ReactNode
}) => {
  const { t } = useTranslation()
  if (!native.state) return null
  return (
    <SettingsCard
      icon={Brain}
      focusId="bundled-embeddings"
      title={t("settings.embeddings.model_select.label")}
      description={t("settings.embeddings.bundled.settings_description")}>
      <NativeEmbeddingFields native={native} settingsView>
        {children}
      </NativeEmbeddingFields>
    </SettingsCard>
  )
}

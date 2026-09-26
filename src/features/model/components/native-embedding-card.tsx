import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
import { useNativeEmbeddings } from "../hooks/use-native-embeddings"
import { NativeEmbeddingFields } from "./native-embedding-fields"

export const NativeEmbeddingCard = () => {
  const { t } = useTranslation()
  const native = useNativeEmbeddings()
  if (!native.state) return null
  return (
    <Card
      className="p-3 space-y-2"
      data-settings-focus="true"
      data-settings-focus-id="bundled-embeddings">
      <h3 className="text-sm font-medium">
        {t("settings.embeddings.bundled.title")}
      </h3>
      <NativeEmbeddingFields native={native} />
    </Card>
  )
}

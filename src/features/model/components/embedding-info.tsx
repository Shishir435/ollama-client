import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"

export const EmbeddingInfo = () => {
  const { t } = useTranslation()

  return (
    <Card className="p-4">
      <h4 className="text-sm font-medium mb-2">
        {t("settings.embeddings.what_are_embeddings.title")}
      </h4>
      <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
        <li>{t("settings.embeddings.what_are_embeddings.point_1")}</li>
        <li>{t("settings.embeddings.what_are_embeddings.point_2")}</li>
        <li>{t("settings.embeddings.what_are_embeddings.point_3")}</li>
        <li>{t("settings.embeddings.what_are_embeddings.point_4")}</li>
      </ul>
    </Card>
  )
}

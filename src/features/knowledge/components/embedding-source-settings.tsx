import { InfoIcon, ServerIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"

export function EmbeddingSourceSettings() {
  const { t } = useTranslation()

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t("model.embedding_config.embedding_source_label")}
        </CardTitle>
        <CardDescription>
          {t("model.embedding_config.embedding_source_description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Default provider info */}
        <div className="flex items-center space-x-3 rounded-md border p-4 bg-muted/50">
          <ServerIcon className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="font-medium">
                {t("model.embedding_config.embedding_source_default_provider")}
              </div>
              <Badge variant="secondary">
                {t("knowledge.embedding_source.status_active")}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("knowledge.embedding_source.provider_details")}
            </div>
          </div>
        </div>

        {/* CSP Information */}
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>
              {t("knowledge.embedding_source.webgpu_warning_title")}
            </strong>{" "}
            {t("knowledge.embedding_source.webgpu_warning_text")}
          </AlertDescription>
        </Alert>

        {/* Performance Info */}
        <div className="rounded-md bg-muted p-3 space-y-2">
          <div className="text-xs font-medium">
            {t("knowledge.embedding_source.performance_title")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("knowledge.embedding_source.performance_default")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("knowledge.embedding_source.provider_hint")}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

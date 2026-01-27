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
        {/* Ollama Info */}
        <div className="flex items-center space-x-3 rounded-md border p-4 bg-muted/50">
          <ServerIcon className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="font-medium">
                {t("model.embedding_config.embedding_source_ollama")}
              </div>
              <Badge variant="secondary">Active</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              High quality embeddings • 768-1024 dimensions • Consistent results
            </div>
          </div>
        </div>

        {/* CSP Information */}
        <Alert>
          <InfoIcon className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>WebGPU embedding generation is unavailable</strong> due to
            Chrome Extension Content Security Policy constraints. WebGPU
            re-ranking is still active and working. All embedding generation
            uses Ollama for compatibility and quality.
          </AlertDescription>
        </Alert>

        {/* Performance Info */}
        <div className="rounded-md bg-muted p-3 space-y-2">
          <div className="text-xs font-medium">Performance</div>
          <div className="text-xs text-muted-foreground">
            Ollama embedding generation: ~500ms per chunk
          </div>
          <div className="text-xs text-muted-foreground">
            Ensure Ollama is running at localhost:11434 for embedding operations
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

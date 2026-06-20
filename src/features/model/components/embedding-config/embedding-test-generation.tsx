import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { generateEmbedding } from "@/lib/embeddings/embedding-client"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { Loader2, Sparkles } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export interface EmbeddingTestGenerationProps {
  modelExists: boolean
}

export const EmbeddingTestGeneration = ({
  modelExists
}: EmbeddingTestGenerationProps) => {
  const { t } = useTranslation()
  const [isTesting, setIsTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  if (!modelExists) return null

  const handleTest = async () => {
    setIsTesting(true)
    setResult(null)
    try {
      const testText =
        "This is a test embedding. Vector embeddings enable semantic search."
      const embeddingResult = await generateEmbedding(testText)

      if ("error" in embeddingResult) {
        setResult(`Error: ${getDisplayErrorMessage(embeddingResult.error)}`)
        return
      }

      setResult(
        `✅ Success! Embedding generated (${embeddingResult.embedding.length}D).`
      )
    } catch (error) {
      setResult(`Error: ${getDisplayErrorMessage(error)}`)
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <SettingsCard
      icon={Sparkles}
      focusId="embeddings-test-generation"
      title={t("settings.embeddings.test_generation.title")}
      description={t("settings.embeddings.test_generation.description")}
      headerActions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={isTesting}>
          {isTesting ? (
            <>
              <Loader2 className="icon-xs mr-2 animate-spin" />
              {t("settings.embeddings.test_generation.button_testing")}
            </>
          ) : (
            t("settings.embeddings.test_generation.button")
          )}
        </Button>
      }>
      {result && (
        <div
          className={cn(
            "px-2 py-2 text-xs rounded border",
            result.startsWith("✅")
              ? "border-primary/20 bg-primary/10 text-primary"
              : "border-destructive/20 bg-destructive/10 text-destructive"
          )}>
          {result}
        </div>
      )}
    </SettingsCard>
  )
}

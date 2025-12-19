import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { buildKeywordIndexFromExisting } from "@/lib/embeddings/auto-index"
import { Database, Loader2 } from "@/lib/lucide-icon"

interface EmbeddingIndexControlsProps {
  modelExists: boolean
}

export const EmbeddingIndexControls = ({
  modelExists
}: EmbeddingIndexControlsProps) => {
  const { t } = useTranslation()

  const [isRebuildingIndex, setIsRebuildingIndex] = useState(false)
  const [rebuildProgress, setRebuildProgress] = useState<{
    current: number
    total: number
    status: string
  } | null>(null)
  const [rebuildResult, setRebuildResult] = useState<string | null>(null)

  const handleRebuildIndex = async () => {
    setIsRebuildingIndex(true)
    setRebuildProgress({
      current: 0,
      total: 100,
      status: t("settings.embeddings.rebuild_index.status_starting")
    })
    setRebuildResult(null)

    try {
      await buildKeywordIndexFromExisting((current, total) => {
        setRebuildProgress({
          current,
          total,
          status: t("settings.embeddings.rebuild_index.status_processing", {
            current,
            total
          })
        })
      }, true) // Force rebuild

      setRebuildResult(`✅ ${t("settings.embeddings.rebuild_index.success")}`)
    } catch (error) {
      console.error("Failed to rebuild index:", error)
      setRebuildResult(`❌ ${t("settings.embeddings.rebuild_index.error")}`)
    } finally {
      setIsRebuildingIndex(false)
      setRebuildProgress(null)
    }
  }

  if (!modelExists) return null

  return (
    <div className="rounded-lg border border-muted bg-muted/30 p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">
          {t("settings.embeddings.rebuild_index.title")}
        </h4>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRebuildIndex}
          disabled={isRebuildingIndex}>
          {isRebuildingIndex ? (
            <>
              <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              {t("settings.embeddings.rebuild_index.button_rebuilding")}
            </>
          ) : (
            <>
              <Database className="h-3 w-3 mr-1" />
              {t("settings.embeddings.rebuild_index.button")}
            </>
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        {t("settings.embeddings.rebuild_index.description")}
      </p>
      {rebuildProgress && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{rebuildProgress.status}</span>
            <span>
              {Math.round(
                (rebuildProgress.current / rebuildProgress.total) * 100
              )}
              %
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{
                width: `${(rebuildProgress.current / rebuildProgress.total) * 100}%`
              }}
            />
          </div>
        </div>
      )}
      {rebuildResult && (
        <div
          className={`text-xs p-2 rounded mt-2 ${
            rebuildResult.startsWith("✅")
              ? "bg-green-500/10 text-green-600 dark:text-green-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          }`}>
          {rebuildResult}
        </div>
      )}
    </div>
  )
}

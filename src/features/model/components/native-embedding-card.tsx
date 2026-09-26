import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { useNativeEmbeddings } from "../hooks/use-native-embeddings"

/** Reused in settings and as the dismissible upgrade announcement in chat. */
export const NativeEmbeddingCard = ({
  announcement = false
}: {
  announcement?: boolean
}) => {
  const { t } = useTranslation()
  const { state, dismissed, busy, error, command } = useNativeEmbeddings()
  if (!state || (announcement && (dismissed || state.mode === "bundled")))
    return null
  const rebuilding = state.migration === "building"
  return (
    <Card
      className="p-3 space-y-2"
      data-settings-focus={announcement ? undefined : "true"}
      data-settings-focus-id={announcement ? undefined : "bundled-embeddings"}>
      <h3 className="text-sm font-medium">
        {t("settings.embeddings.bundled.title")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {t(
          state.mode === "bundled"
            ? "settings.embeddings.bundled.active"
            : "settings.embeddings.bundled.offer"
        )}
      </p>
      {state.mode !== "bundled" && (
        <p className="text-xs text-muted-foreground">
          {t("settings.embeddings.bundled.details")}
        </p>
      )}
      {rebuilding && (
        <>
          <p className="text-xs" role="status">
            {t("settings.embeddings.bundled.progress", {
              current: state.current,
              total: state.total
            })}
          </p>
          <Progress
            value={state.total ? (100 * state.current) / state.total : 0}
          />
        </>
      )}
      {(error || state.migration === "changed") && (
        <p className="text-xs text-destructive" role="alert">
          {t(
            state.migration === "changed"
              ? "settings.embeddings.bundled.changed"
              : "settings.embeddings.bundled.error"
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {state.mode !== "bundled" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void command(rebuilding ? "step" : "start")}>
            {t(
              rebuilding
                ? "settings.embeddings.bundled.resume"
                : "settings.embeddings.bundled.migrate"
            )}
          </Button>
        )}
        {state.mode !== "bundled" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void command("keep")}>
            {t("settings.embeddings.bundled.keep")}
          </Button>
        )}
        {state.mode === "bundled" && !announcement && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void command("external")}>
            {t("settings.embeddings.bundled.external")}
          </Button>
        )}
      </div>
    </Card>
  )
}

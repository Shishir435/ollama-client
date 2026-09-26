import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { useNativeEmbeddings } from "../hooks/use-native-embeddings"

/** Shared migration controls for settings and the upgrade dialog. */
export const NativeEmbeddingFields = ({
  native
}: {
  native: ReturnType<typeof useNativeEmbeddings>
}) => {
  const { t } = useTranslation()
  const { state, busy, error, command } = native
  if (!state) return null
  const rebuilding = state.migration === "building"
  return (
    <>
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
        {state.mode === "bundled" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void command("external")}>
            {t("settings.embeddings.bundled.external")}
          </Button>
        )}
      </div>
    </>
  )
}

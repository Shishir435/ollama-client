import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { useNativeEmbeddings } from "../hooks/use-native-embeddings"

/** Shared migration controls for settings and the upgrade dialog. */
export const NativeEmbeddingFields = ({
  native,
  children,
  settingsView = false,
  targetMode
}: {
  native: ReturnType<typeof useNativeEmbeddings>
  children?: ReactNode
  settingsView?: boolean
  targetMode?: "bundled" | "external"
}) => {
  const { t } = useTranslation()
  const { state, busy, error, command } = native
  if (!state) return null
  const rebuilding = state.migration === "building"
  const switching = !settingsView || rebuilding || targetMode !== state.mode
  return (
    <>
      <p
        className={
          settingsView ? "text-sm font-medium" : "text-xs text-muted-foreground"
        }>
        {t(
          settingsView
            ? `settings.embeddings.bundled.current_${state.mode}`
            : state.mode === "bundled"
              ? "settings.embeddings.bundled.active"
              : "settings.embeddings.bundled.offer"
        )}
      </p>
      <p className="text-xs font-medium">
        {t(
          settingsView
            ? "settings.embeddings.bundled.mode_language_hint"
            : "settings.embeddings.bundled.language_notice"
        )}
      </p>
      {!settingsView && (state.mode !== "bundled" || rebuilding) && (
        <p className="text-xs text-muted-foreground">
          {t("settings.embeddings.bundled.details")}
        </p>
      )}
      {children}
      {settingsView && switching && (
        <p className="text-xs text-muted-foreground">
          {t("settings.embeddings.bundled.switch_hint")}
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
        {(rebuilding || busy) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void command("cancel")}>
            {t("common.cancel")}
          </Button>
        )}
        {switching && state.mode !== "bundled" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void command(rebuilding ? "step" : "start")}>
            {t(
              rebuilding
                ? "settings.embeddings.bundled.resume"
                : settingsView
                  ? "settings.embeddings.bundled.switch_builtin"
                  : "settings.embeddings.bundled.migrate"
            )}
          </Button>
        )}
        {!settingsView && state.mode !== "bundled" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void command("keep")}>
            {t("settings.embeddings.bundled.keep")}
          </Button>
        )}
        {switching && state.mode === "bundled" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void command(rebuilding ? "step" : "external")}>
            {t(
              rebuilding
                ? "settings.embeddings.bundled.resume"
                : "settings.embeddings.bundled.switch_server"
            )}
          </Button>
        )}
      </div>
    </>
  )
}

import { Brain } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
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
  const group = useId()
  const [choice, setChoice] = useState<"bundled" | "external">()

  if (!native.state) return null
  const rebuilding = native.state.migration === "building"
  const selected = rebuilding
    ? native.state.target || native.state.mode
    : choice || native.state.mode
  return (
    <SettingsCard
      icon={Brain}
      focusId="bundled-embeddings"
      title={t("settings.embeddings.bundled.mode_title")}
      description={t("settings.embeddings.bundled.settings_description")}>
      <NativeEmbeddingFields native={native} settingsView targetMode={selected}>
        <fieldset
          className="grid gap-3 sm:grid-cols-2"
          disabled={native.busy || rebuilding}>
          <legend className="sr-only">
            {t("settings.embeddings.bundled.mode_title")}
          </legend>
          {(["bundled", "external"] as const).map((mode) => (
            <label
              key={mode}
              className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 ${selected === mode ? "border-primary bg-app-primary-soft" : "border-border"}`}>
              <input
                className="mt-1 accent-primary"
                type="radio"
                name={group}
                value={mode}
                checked={selected === mode}
                onChange={() => setChoice(mode)}
                aria-label={t(`settings.embeddings.bundled.mode_${mode}`)}
              />
              <span>
                <span className="block text-sm font-medium">
                  {t(`settings.embeddings.bundled.mode_${mode}`)}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(`settings.embeddings.bundled.mode_${mode}_help`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {selected === "external" && children}
      </NativeEmbeddingFields>
    </SettingsCard>
  )
}

import { useStorage } from "@plasmohq/storage/hook"
import { Trans, useTranslation } from "react-i18next"

import { SelectRow, SettingsCard } from "@/components/settings"
import { SelectItem } from "@/components/ui/select"
import { LANGUAGES } from "@/i18n/languages"
import { STORAGE_KEYS } from "@/lib/constants"
import { Globe } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const LanguageSelector = () => {
  const { t, i18n } = useTranslation()
  const [_, setStoredLanguage] = useStorage({
    key: STORAGE_KEYS.LANGUAGE,
    instance: plasmoGlobalStorage
  })

  return (
    <SettingsCard
      icon={Globe}
      title={t("common.language.label")}
      description={t("common.language.description")}
      badge={t("common.language.beta_badge")}>
      {(() => {
        const languageMap = new Map(
          LANGUAGES.map((lang) => [
            lang.value,
            lang.label === lang.nativeLabel
              ? lang.label
              : `${lang.label} (${lang.nativeLabel})`
          ])
        )
        const currentLabel = languageMap.get(
          i18n.language as (typeof LANGUAGES)[number]["value"]
        )
        return (
          <SelectRow
            id="language-select"
            label={t("common.language.select_label")}
            value={i18n.language}
            valueLabel={currentLabel || i18n.language}
            onValueChange={(value) => {
              i18n.changeLanguage(value)
              setStoredLanguage(value)
            }}>
            {LANGUAGES.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label === lang.nativeLabel
                  ? lang.label
                  : `${lang.label} (${lang.nativeLabel})`}
              </SelectItem>
            ))}
          </SelectRow>
        )
      })()}

      <p className="text-xs text-muted-foreground italic">
        <Trans
          i18nKey="common.language.help_text"
          components={[
            <a
              key="github-link"
              href="https://github.com/Shishir435/ollama-client/discussions/38"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-primary">
              GitHub
            </a>
          ]}
        />
      </p>
    </SettingsCard>
  )
}

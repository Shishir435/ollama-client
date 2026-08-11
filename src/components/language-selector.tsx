import { Globe } from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import { SettingsCard, SettingsSelectField } from "@/components/settings"
import { SelectItem } from "@/components/ui/select"
import { useSetting } from "@/hooks/use-setting"
import { LANGUAGES } from "@/i18n/languages"
import { EXTERNAL_URLS } from "@/lib/constants"
import { SETTINGS } from "@/lib/storage/settings"

export const LanguageSelector = () => {
  const { t, i18n } = useTranslation()
  const [_, setStoredLanguage] = useSetting(SETTINGS.LANGUAGE)

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
          <SettingsSelectField
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
          </SettingsSelectField>
        )
      })()}

      <p className="text-xs text-muted-foreground italic">
        <Trans
          i18nKey="common.language.help_text"
          components={[
            <a
              key="github-link"
              href={EXTERNAL_URLS.I18N_DISCUSSION_GITHUB}
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

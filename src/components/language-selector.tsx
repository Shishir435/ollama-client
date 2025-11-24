import { useStorage } from "@plasmohq/storage/hook"
import { Trans, useTranslation } from "react-i18next"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { MiniBadge } from "@/components/ui/mini-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
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
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">
            {t("common.language.label")}
          </CardTitle>
          <MiniBadge text={t("common.language.beta_badge")} />
        </div>
        <CardDescription className="text-sm">
          {t("common.language.description")}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-3">
          <Label htmlFor="language-select" className="text-sm font-medium">
            {t("common.language.select_label")}
          </Label>
          <Select
            value={i18n.language}
            onValueChange={(value) => {
              i18n.changeLanguage(value)
              setStoredLanguage(value)
            }}>
            <SelectTrigger id="language-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
      </CardContent>
    </Card>
  )
}

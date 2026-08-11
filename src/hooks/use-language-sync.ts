import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"

export const useLanguageSync = () => {
  const { i18n } = useTranslation()
  const [storedLanguage] = useSetting(SETTINGS.LANGUAGE)

  // biome-ignore lint/correctness/useExhaustiveDependencies: i18n.changeLanguage is a stable function reference
  useEffect(() => {
    if (storedLanguage && i18n.language !== storedLanguage) {
      i18n.changeLanguage(storedLanguage)
    }
  }, [storedLanguage])
}

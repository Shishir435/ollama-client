import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useSetting } from "@/hooks/use-setting"
import { SETTINGS } from "@/lib/storage/settings"

export const useLanguageSync = () => {
  const { i18n } = useTranslation()
  const [storedLanguage] = useSetting(SETTINGS.LANGUAGE)

  useEffect(() => {
    if (storedLanguage && i18n.language !== storedLanguage) {
      i18n.changeLanguage(storedLanguage)
    }
  }, [storedLanguage, i18n, i18n.language])
}

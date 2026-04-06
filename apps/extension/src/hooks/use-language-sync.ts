import { useStorage } from "@plasmohq/storage/hook"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { STORAGE_KEYS } from "@/lib/constants"

import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const useLanguageSync = () => {
  const { i18n } = useTranslation()
  const [storedLanguage] = useStorage<string>({
    key: STORAGE_KEYS.LANGUAGE,
    instance: plasmoGlobalStorage
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: i18n.changeLanguage is a stable function reference
  useEffect(() => {
    if (storedLanguage && i18n.language !== storedLanguage) {
      i18n.changeLanguage(storedLanguage)
    }
  }, [storedLanguage])
}

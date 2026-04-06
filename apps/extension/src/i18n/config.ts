import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import resourcesToBackend from "i18next-resources-to-backend"
import { initReactI18next } from "react-i18next"
import { LANGUAGES } from "./languages"

const translationLoaders = import.meta.glob("../locales/*/translation.json")

const loadTranslation = async (language: string) => {
  const match = Object.entries(translationLoaders).find(([path]) =>
    path.includes(`/${language}/translation.json`)
  )

  if (!match) {
    return {}
  }

  const moduleLoader = match[1] as () => Promise<{ default: unknown }>
  const module = await moduleLoader()
  return module.default ?? {}
}

i18n
  .use(LanguageDetector)
  .use(
    resourcesToBackend(async (language) => {
      const translation = await loadTranslation(language)
      return translation as Record<string, unknown>
    })
  )
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    // Only list languages we have translations for
    // Add more language codes here as translations become available
    supportedLngs: LANGUAGES.map((l) => l.value),
    debug: process.env.NODE_ENV === "development",
    interpolation: {
      escapeValue: false // not needed for react as it escapes by default
    },
    react: {
      useSuspense: true // enable suspense for loading translations
    }
  })

export default i18n

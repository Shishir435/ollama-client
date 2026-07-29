import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next } from "react-i18next"
import { LANGUAGES } from "./languages"
import { loadTranslation } from "./locale-loader"

const lazyLocaleBackend = {
  type: "backend" as const,
  init: () => undefined,
  read: (
    language: string,
    _namespace: string,
    callback: (error: Error | null, resources?: Record<string, unknown>) => void
  ) => {
    loadTranslation(language)
      .then((translation) => callback(null, translation))
      .catch((error: unknown) =>
        callback(
          error instanceof Error ? error : new Error("Failed to load locale")
        )
      )
  }
}

i18n.use(LanguageDetector).use(lazyLocaleBackend).use(initReactI18next)

export const i18nReady = i18n.init({
  fallbackLng: "en",
  defaultNS: "translation",
  ns: ["translation"],
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

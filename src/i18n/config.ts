import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next } from "react-i18next"
import { resources } from "./resources"

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    // Only list languages we have translations for
    // Add more language codes here as translations become available
    supportedLngs: Object.keys(resources),
    debug: process.env.NODE_ENV === "development",
    interpolation: {
      escapeValue: false // not needed for react as it escapes by default
    },
    react: {
      useSuspense: true // enable suspense for loading translations
    }
  })

export default i18n

import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { loadSelectionTranslation } from "./selection-locale-loader"

export const selectionI18n = i18n.createInstance()
selectionI18n.use(initReactI18next)

let languageChangeQueue = Promise.resolve()

export const setSelectionLanguage = (language?: string): Promise<void> => {
  languageChangeQueue = languageChangeQueue
    .catch(() => {})
    .then(async () => {
      let loaded: Awaited<ReturnType<typeof loadSelectionTranslation>>
      try {
        loaded = await loadSelectionTranslation(language)
      } catch {
        try {
          loaded = await loadSelectionTranslation("en")
        } catch {
          loaded = { language: "en", translation: {} }
        }
      }

      if (!selectionI18n.isInitialized) {
        await selectionI18n.init({
          lng: loaded.language,
          fallbackLng: false,
          resources: {
            [loaded.language]: { translation: loaded.translation }
          },
          interpolation: {
            escapeValue: false
          },
          react: {
            useSuspense: true
          }
        })
        return
      }

      if (!selectionI18n.hasResourceBundle(loaded.language, "translation")) {
        selectionI18n.addResourceBundle(
          loaded.language,
          "translation",
          loaded.translation
        )
      }
      await selectionI18n.changeLanguage(loaded.language)
    })

  return languageChangeQueue
}

export default selectionI18n

import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { selectionResources } from "./selection-resources"

export const selectionI18n = i18n.createInstance()

export const selectionI18nReady = selectionI18n.use(initReactI18next).init({
  resources: selectionResources,
  fallbackLng: "en",
  supportedLngs: Object.keys(selectionResources),
  interpolation: {
    escapeValue: false
  },
  react: {
    useSuspense: true
  }
})

export default selectionI18n

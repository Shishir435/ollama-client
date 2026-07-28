import type { LANGUAGES } from "./languages"

export type SupportedLanguage = (typeof LANGUAGES)[number]["value"]
export type TranslationResource = Record<string, unknown>

type TranslationModule = {
  default: TranslationResource
}

const localeLoaders: Record<
  SupportedLanguage,
  () => Promise<TranslationModule>
> = {
  de: () => import("@/locales/de/translation.json"),
  en: () => import("@/locales/en/translation.json"),
  es: () => import("@/locales/es/translation.json"),
  fr: () => import("@/locales/fr/translation.json"),
  hi: () => import("@/locales/hi/translation.json"),
  it: () => import("@/locales/it/translation.json"),
  ja: () => import("@/locales/ja/translation.json"),
  ru: () => import("@/locales/ru/translation.json"),
  zh: () => import("@/locales/zh/translation.json")
}

export const normalizeSupportedLanguage = (
  language: string | null | undefined
): SupportedLanguage => {
  const base = language?.toLowerCase().split("-")[0]
  return base && base in localeLoaders ? (base as SupportedLanguage) : "en"
}

export const loadTranslation = async (
  language: string | null | undefined
): Promise<TranslationResource> => {
  const module = await localeLoaders[normalizeSupportedLanguage(language)]()
  return module.default
}

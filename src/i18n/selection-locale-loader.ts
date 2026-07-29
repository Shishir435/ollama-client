type SupportedLanguage =
  | "de"
  | "en"
  | "es"
  | "fr"
  | "hi"
  | "it"
  | "ja"
  | "ru"
  | "zh"
type TranslationResource = Record<string, unknown>

const supportedLanguages = new Set<SupportedLanguage>([
  "de",
  "en",
  "es",
  "fr",
  "hi",
  "it",
  "ja",
  "ru",
  "zh"
])

const normalizeSelectionLanguage = (
  language: string | null | undefined
): SupportedLanguage => {
  const base = language?.toLowerCase().split("-")[0] as
    | SupportedLanguage
    | undefined
  return base && supportedLanguages.has(base) ? base : "en"
}

export const loadSelectionTranslation = async (
  language: string | null | undefined
): Promise<{
  language: SupportedLanguage
  translation: TranslationResource
}> => {
  const normalizedLanguage = normalizeSelectionLanguage(language)
  const response = await fetch(
    chrome.runtime.getURL(`assets/selection-locales/${normalizedLanguage}.json`)
  )
  if (!response.ok) {
    throw new Error(
      `Unable to load selection locale "${normalizedLanguage}" (${response.status})`
    )
  }
  return {
    language: normalizedLanguage,
    translation: (await response.json()) as TranslationResource
  }
}

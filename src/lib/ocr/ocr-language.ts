export type OcrLanguageOption = {
  label: string
  value: string
}

export const ocrLanguages: OcrLanguageOption[] = [
  { label: "English", value: "eng" }
]

export const getDefaultOcrLanguage = () => "eng"

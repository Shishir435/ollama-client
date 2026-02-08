import { useStorage } from "@plasmohq/storage/hook"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

const translations: Record<string, Record<string, string>> = {
  en: {
    "selection_button.label": "Ask Local LLM",
    "selection_button.tooltip": "Add to Local LLM Client"
  },
  fr: {
    "selection_button.label": "Demander au LLM local",
    "selection_button.tooltip": "Ajouter au client LLM local"
  },
  zh: {
    "selection_button.label": "询问本地 LLM",
    "selection_button.tooltip": "添加到本地 LLM 客户端"
  }
}

export const useLiteTranslation = () => {
  const [lang] = useStorage<string>({
    key: STORAGE_KEYS.LANGUAGE,
    instance: plasmoGlobalStorage
  })

  const t = (key: string) => {
    const language = lang || "en"
    let targetLang = language

    // Simple fallback logic
    if (!translations[targetLang]) {
      if (typeof targetLang === "string") {
        if (targetLang.startsWith("zh")) targetLang = "zh"
        else if (targetLang.startsWith("fr")) targetLang = "fr"
        else targetLang = "en"
      } else {
        targetLang = "en"
      }
    }

    // Safety check if language still not found
    if (!translations[targetLang]) {
      targetLang = "en"
    }

    return translations[targetLang]?.[key] || translations["en"]?.[key] || key
  }

  return { t }
}

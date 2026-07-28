import { useStorage } from "@plasmohq/storage/hook"
import {
  AppWindow,
  BrainCircuit,
  Camera,
  Search,
  ShieldCheck
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { useSelectedModelCapabilities } from "@/features/model/hooks/use-selected-model-capabilities"
import {
  useWebSearchActive,
  useWebSearchConfig
} from "@/features/web-search/stores/web-search-config-store"
import {
  DEFAULT_CONTENT_EXTRACTION_CONFIG,
  DEFAULT_EXCLUDE_URLS,
  DEFAULT_TABS_ACCESS,
  STORAGE_KEYS
} from "@/lib/constants"
import type { LucideIcon } from "@/lib/lucide-icon"
import {
  DEFAULT_PER_SITE_PROFILE_SETTINGS,
  type PerSiteProfileSettings
} from "@/lib/per-site-profiles"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ContentExtractionConfig } from "@/types"

const EMPTY_PROFILE_LIST: PerSiteProfileSettings["profiles"] = []

export interface ContextToggleAction {
  key: string
  checked: boolean
  onClick: () => void
  icon: LucideIcon
  label: string
}

/**
 * Every per-conversation context switch the Context sheet offers, plus the two
 * settings it reads to decide which switches exist at all.
 *
 * The toggles are device-local settings rather than component state, so they
 * live behind `useStorage` and stay in sync with the options page. `toggleActions`
 * is built here because whether a row exists depends on the selected model's
 * capabilities and on web search being configured — the sheet should not have to
 * re-derive that.
 */
export const useContextSettings = () => {
  const { t } = useTranslation()

  const [useRAG, setUseRAG] = useStorage<boolean>(
    { key: STORAGE_KEYS.EMBEDDINGS.USE_RAG, instance: plasmoGlobalStorage },
    true
  )
  const [tabAccess, setTabAccess] = useStorage<boolean>(
    { key: STORAGE_KEYS.BROWSER.TABS_ACCESS, instance: plasmoGlobalStorage },
    DEFAULT_TABS_ACCESS
  )
  const [groundedOnlyMode, setGroundedOnlyMode] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.CHAT.GROUNDED_ONLY_MODE,
      instance: plasmoGlobalStorage
    },
    false
  )
  const [autoScreenshotOnVision, setAutoScreenshotOnVision] =
    useStorage<boolean>(
      {
        key: STORAGE_KEYS.CHAT.AUTO_SCREENSHOT_ON_VISION,
        instance: plasmoGlobalStorage
      },
      false
    )
  const [config] = useStorage<ContentExtractionConfig>(
    {
      key: STORAGE_KEYS.BROWSER.CONTENT_EXTRACTION_CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_CONTENT_EXTRACTION_CONFIG
  )
  const [oldPatterns] = useStorage<string[]>(
    {
      key: STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EXCLUDE_URLS
  )
  const [perSiteProfiles] = useStorage<PerSiteProfileSettings>(
    {
      key: STORAGE_KEYS.BROWSER.PER_SITE_PROFILES,
      instance: plasmoGlobalStorage
    },
    DEFAULT_PER_SITE_PROFILE_SETTINGS
  )

  const { capabilities, isResolving } = useSelectedModelCapabilities()
  const { config: webSearchConfig } = useWebSearchConfig()
  const { active: webSearchActive, setActive: setWebSearchActive } =
    useWebSearchActive()

  const showAutoScreenshot = capabilities?.vision ?? false
  // The row appears only when web search is configured in settings; its check
  // controls the per-device active flag, never the settings switch.
  const showWebSearch =
    (Boolean(capabilities?.toolCalling) || isResolving) &&
    Boolean(webSearchConfig.enabled)

  const toggleActions: ContextToggleAction[] = [
    {
      key: "page",
      checked: Boolean(tabAccess),
      onClick: () => setTabAccess(!tabAccess),
      icon: AppWindow,
      label: tabAccess ? t("tabs.toggle.label_on") : t("tabs.toggle.label_off")
    },
    {
      key: "rag",
      checked: Boolean(useRAG),
      onClick: () => setUseRAG(!useRAG),
      icon: BrainCircuit,
      label: useRAG
        ? t("chat.input.rag_toggle_on")
        : t("chat.input.rag_toggle_off")
    },
    ...(showWebSearch
      ? [
          {
            key: "web",
            checked: webSearchActive,
            onClick: () => setWebSearchActive(!webSearchActive),
            icon: Search,
            label: t("chat.context.web")
          }
        ]
      : []),
    {
      key: "grounded",
      checked: Boolean(groundedOnlyMode),
      onClick: () => setGroundedOnlyMode(!groundedOnlyMode),
      icon: ShieldCheck,
      label: t("settings.grounding_mode.label")
    },
    ...(showAutoScreenshot
      ? [
          {
            key: "auto-screenshot",
            checked: Boolean(autoScreenshotOnVision),
            onClick: () => setAutoScreenshotOnVision(!autoScreenshotOnVision),
            icon: Camera,
            label: t("chat.input.auto_screenshot")
          }
        ]
      : [])
  ]

  return {
    tabAccess: Boolean(tabAccess),
    useRAG: Boolean(useRAG),
    webSearchActive,
    showWebSearch,
    toggleActions,
    excludedPatterns:
      config?.excludedUrlPatterns || oldPatterns || DEFAULT_EXCLUDE_URLS,
    perSiteProfileList: perSiteProfiles?.profiles ?? EMPTY_PROFILE_LIST
  }
}

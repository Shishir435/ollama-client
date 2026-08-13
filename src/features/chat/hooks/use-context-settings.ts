import {
  AppWindow,
  BrainCircuit,
  Camera,
  type LucideIcon,
  Search,
  ShieldCheck
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { useSelectedModelCapabilities } from "@/features/model/hooks/use-selected-model-capabilities"
import {
  useWebSearchActive,
  useWebSearchConfig
} from "@/features/web-search/stores/web-search-config-store"
import { useSetting } from "@/hooks/use-setting"
import { DEFAULT_EXCLUDE_URLS } from "@/lib/constants"
import {
  type PerSiteProfileSettings,
  parsePerSiteProfileSettings
} from "@/lib/per-site-profiles"
import { SETTINGS } from "@/lib/storage/settings"

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

  const [useRAG, setUseRAG] = useSetting(SETTINGS.USE_RAG)
  const [tabAccess, setTabAccess] = useSetting(SETTINGS.TABS_ACCESS)
  const [groundedOnlyMode, setGroundedOnlyMode] = useSetting(
    SETTINGS.GROUNDED_ONLY_MODE
  )
  const [autoScreenshotOnVision, setAutoScreenshotOnVision] = useSetting(
    SETTINGS.AUTO_SCREENSHOT_ON_VISION
  )
  const [config] = useSetting(SETTINGS.CONTENT_EXTRACTION_CONFIG)
  const [oldPatterns] = useSetting(SETTINGS.EXCLUDE_URL_PATTERNS)
  const [perSiteProfiles] = useSetting(SETTINGS.PER_SITE_PROFILES)

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

  // Each row carries one stable label. They used to change with state — "Tabs"
  // became "Tab+" and "RAG" became "RAG+" when switched on — which made the
  // label do the checkmark's job in a notation nobody could read, and meant the
  // row you were looking for was worded differently depending on its state.
  const toggleActions: ContextToggleAction[] = [
    {
      key: "page",
      checked: Boolean(tabAccess),
      onClick: () => setTabAccess(!tabAccess),
      icon: AppWindow,
      label: t("chat.context.rows.tabs")
    },
    {
      key: "rag",
      checked: Boolean(useRAG),
      onClick: () => setUseRAG(!useRAG),
      icon: BrainCircuit,
      label: t("chat.context.rows.knowledge")
    },
    ...(showWebSearch
      ? [
          {
            key: "web",
            checked: webSearchActive,
            onClick: () => setWebSearchActive(!webSearchActive),
            icon: Search,
            label: t("chat.context.rows.web")
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
    perSiteProfileList:
      parsePerSiteProfileSettings(perSiteProfiles).profiles ??
      EMPTY_PROFILE_LIST
  }
}

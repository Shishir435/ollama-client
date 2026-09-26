import { STORAGE_KEYS } from "@/lib/constants"
import type { SettingsEntryDefinition } from "./types"

export const BROWSER_SETTINGS = [
  // ---- Browser agent -----------------------------------------------------
  {
    id: "agent-enabled",
    sectionId: "agent",
    labelKey: "agent.settings.enabled.label",
    descriptionKey: "agent.settings.enabled.description",
    storageKey: STORAGE_KEYS.AGENT.ENABLED,
    searchKeys: ["agent.settings.title", "agent.experimental_badge"],
    keywords: ["agent", "experimental", "browser", "enable"],
    aliases: ["turn on agent", "browser automation", "browser_task"]
  },
  {
    id: "agent-permission-mode",
    sectionId: "agent",
    labelKey: "agent.settings.permission_mode.label",
    descriptionKey: "agent.settings.permission_mode.description",
    storageKey: STORAGE_KEYS.AGENT.PERMISSION_MODE,
    searchKeys: [
      "agent.settings.title",
      "agent.settings.permission_mode.allow_routine",
      "agent.settings.permission_mode.approve_each"
    ],
    keywords: ["agent", "approval", "permission", "routine"],
    aliases: ["auto approve", "ask every step", "agent permissions"]
  },
  {
    id: "agent-context-window",
    sectionId: "agent",
    labelKey: "agent.settings.context_window.label",
    descriptionKey: "agent.settings.context_window.description",
    storageKey: STORAGE_KEYS.AGENT.CONTEXT_WINDOW,
    level: "power",
    searchKeys: [
      "agent.settings.title",
      "agent.settings.context_window.auto",
      "agent.settings.context_window.custom"
    ],
    keywords: ["agent", "context", "window", "tokens"],
    aliases: ["num_ctx", "context length", "prompt size", "agent memory"]
  },
  {
    id: "agent-vision",
    sectionId: "agent",
    labelKey: "agent.settings.vision.label",
    descriptionKey: "agent.settings.vision.description",
    storageKey: STORAGE_KEYS.AGENT.VISION,
    level: "advanced",
    searchKeys: [
      "agent.settings.vision.auto",
      "agent.settings.vision.always",
      "agent.settings.vision.never"
    ],
    keywords: ["agent", "screenshot", "vision", "image"],
    aliases: ["agent screenshots", "picture the page", "see the page"]
  },
  // ---- Content Extraction ------------------------------------------------
  {
    id: "content-extraction-enabled",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.enable.label",
    descriptionKey: "settings.content_extraction.enable.description",
    keywords: ["content extraction", "scrape", "page"],
    aliases: ["page reading", "read page", "website text", "current page"]
  },
  {
    id: "content-scraper",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.scraper.label",
    level: "power",
    keywords: ["scraper", "extraction", "engine"]
  },
  {
    id: "scroll-strategy",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.scroll_strategy.label",
    level: "advanced",
    keywords: ["scroll", "strategy"]
  },
  {
    id: "scroll-depth",
    sectionId: "content-extraction",
    labelKey: "settings.content_extraction.scroll_depth.label",
    descriptionKey: "settings.content_extraction.scroll_depth.description",
    level: "advanced",
    keywords: ["scroll", "depth"]
  },
  {
    id: "site-overrides",
    sectionId: "site-overrides",
    labelKey: "model.site_overrides.title",
    descriptionKey: "model.site_overrides.description",
    level: "power",
    searchKeys: [
      "model.site_overrides.scroll_strategy_label",
      "model.site_overrides.scroll_depth_label",
      "settings.permissions.siteProfiles.fields.tabContext",
      "settings.permissions.siteProfiles.fields.groundedOnly"
    ],
    aliases: [
      "site overrides",
      "per-site",
      "auto context",
      "never read",
      "grounded only",
      "domain rules"
    ]
  },
  // selection-actions labels are localized in Phase 6 #13; ids/keys reserved
  // here so search + focus light up the moment those keys land.
  {
    id: "selection-actions-enabled",
    sectionId: "selection-actions",
    labelKey: "settings.content_extraction.selection_actions.label",
    descriptionKey: "settings.content_extraction.selection_actions.description",
    level: "power",
    keywords: ["selection", "actions", "highlight", "toolbar"]
  },
  {
    id: "selection-actions-min-chars",
    sectionId: "selection-actions",
    labelKey: "settings.content_extraction.selection_actions_min_chars.label",
    descriptionKey:
      "settings.content_extraction.selection_actions_min_chars.description",
    level: "power",
    keywords: ["selection", "minimum", "characters"]
  },
  {
    id: "scroll-delay",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.scroll_delay",
    advanced: true,
    keywords: ["scroll delay", "timeout", "milliseconds"]
  },
  {
    id: "mutation-timeout",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.mutation_timeout",
    advanced: true,
    keywords: ["mutation", "timeout", "milliseconds"]
  },
  {
    id: "network-timeout",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.network_timeout",
    advanced: true,
    keywords: ["network", "idle", "timeout", "milliseconds"]
  },
  {
    id: "max-wait",
    sectionId: "content-extraction-timeouts",
    labelKey: "settings.content_extraction.timeout.max_wait",
    advanced: true,
    keywords: ["max wait", "timeout", "milliseconds"]
  }
] satisfies SettingsEntryDefinition[]

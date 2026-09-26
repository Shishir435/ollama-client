import type { SettingsEntryDefinition } from "./types"

export const BROWSER_SETTINGS = [
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

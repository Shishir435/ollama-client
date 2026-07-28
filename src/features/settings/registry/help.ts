import type { SettingsEntryDefinition } from "./types"

export const HELP_SETTINGS = [
  {
    id: "diagnostics-support",
    sectionId: "diagnostics",
    labelKey: "diagnostics.title",
    descriptionKey: "diagnostics.description",
    searchKeys: ["diagnostics.run", "diagnostics.preview"],
    aliases: ["support bundle", "self test", "support code"]
  },

  // ---- Guides ------------------------------------------------------------
  {
    id: "guides-overview",
    focusId: "guides-card",
    sectionId: "guides",
    labelKey: "guides.title",
    descriptionKey: "guides.description",
    aliases: ["documentation", "docs", "help"]
  },
  {
    id: "guide-setup",
    sectionId: "guides",
    labelKey: "guides.items.setup.label",
    descriptionKey: "guides.items.setup.description",
    searchKeys: ["guides.items.setup.badge"],
    aliases: ["setup guide", "install guide"]
  },
  {
    id: "guide-library",
    sectionId: "guides",
    labelKey: "guides.items.library.label",
    descriptionKey: "guides.items.library.description",
    searchKeys: ["guides.items.library.badge"],
    aliases: ["model library", "ollama library"]
  },
  {
    id: "guide-github",
    sectionId: "guides",
    labelKey: "guides.items.github.label",
    descriptionKey: "guides.items.github.description",
    searchKeys: ["guides.items.github.badge"],
    aliases: ["github", "repo", "source code", "releases"]
  },
  {
    id: "guide-issue",
    sectionId: "guides",
    labelKey: "guides.items.issue.label",
    descriptionKey: "guides.items.issue.description",
    searchKeys: ["guides.items.issue.badge"],
    aliases: ["bug", "issue", "support", "feedback", "github issue"]
  },
  {
    id: "guide-faq",
    sectionId: "guides",
    labelKey: "guides.items.faq.label",
    descriptionKey: "guides.items.faq.description",
    searchKeys: ["guides.items.faq.badge"],
    aliases: ["faq", "troubleshooting", "support"]
  },
  {
    id: "guide-support",
    sectionId: "guides",
    labelKey: "guides.support.title",
    descriptionKey: "guides.support.description",
    aliases: ["product hunt", "support project"]
  }
] satisfies SettingsEntryDefinition[]

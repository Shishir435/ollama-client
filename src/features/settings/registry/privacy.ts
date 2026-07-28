import { STORAGE_KEYS } from "@/lib/constants"
import type { SettingsEntryDefinition } from "./types"

const extensionGlobals = globalThis as unknown as {
  navigator?: { userAgent?: string }
  browser?: Record<string, unknown>
  chrome?: Record<string, unknown>
}
const firefoxMajorVersion = Number(
  extensionGlobals.navigator?.userAgent?.match(/Firefox\/(\d+)/i)?.[1] ?? 0
)
const TAB_GROUPS_AVAILABLE =
  typeof extensionGlobals.browser?.tabGroups !== "undefined" ||
  typeof extensionGlobals.chrome?.tabGroups !== "undefined" ||
  firefoxMajorVersion >= 139

export const PRIVACY_SETTINGS = [
  // NOTE: the old "embeddings-search" advanced card (search limit, min
  // similarity, cache TTL/size, ANN backend/min-vectors) no longer exists in
  // the UI — its config fields are internal now. Registry entries for it were
  // removed so search never offers results that focus nothing. The live
  // search-limit and rerank-threshold sliders in RAG settings have their own
  // entries ("search-limit-topk", "min-rerank-score").
  {
    id: "data-migration-export",
    sectionId: "data-migration",
    labelKey: "settings.migration.export.button",
    descriptionKey: "settings.migration.export.description",
    keywords: ["export", "backup", "migration", "data backup"]
  },
  {
    id: "data-migration-import",
    sectionId: "data-migration",
    labelKey: "settings.migration.import.button",
    descriptionKey: "settings.migration.import.description",
    keywords: ["import", "restore", "migration", "data backup"]
  },

  // ---- Reset -------------------------------------------------------------
  {
    id: "reset-settings",
    sectionId: "reset-modules",
    labelKey: "settings.reset.title",
    descriptionKey: "settings.reset.description",
    aliases: ["reset settings", "clear data"]
  },
  {
    id: "reset-provider",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.provider.title",
    descriptionKey: "settings.reset.modules.provider.description",
    aliases: ["provider settings", "models", "configuration"]
  },
  {
    id: "reset-theme",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.theme.title",
    descriptionKey: "settings.reset.modules.theme.description",
    aliases: ["theme", "ui", "appearance"]
  },
  {
    id: "reset-browser",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.browser.title",
    descriptionKey: "settings.reset.modules.browser.description",
    aliases: ["browser settings", "tab access", "url patterns"]
  },
  {
    id: "reset-tts",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.tts.title",
    descriptionKey: "settings.reset.modules.tts.description",
    aliases: ["text to speech", "tts", "speech"]
  },
  {
    id: "reset-chat-sessions",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.chat_sessions.title",
    descriptionKey: "settings.reset.modules.chat_sessions.description",
    aliases: ["chat history", "conversation history"]
  },
  {
    id: "reset-feedback",
    sectionId: "reset-modules",
    labelKey: "settings.reset.modules.feedback.title",
    descriptionKey: "settings.reset.modules.feedback.description",
    aliases: ["user feedback", "learning feedback"]
  },
  {
    id: "reset-danger-zone",
    sectionId: "reset-modules",
    labelKey: "settings.reset.danger_zone.title",
    descriptionKey: "settings.reset.danger_zone.description",
    searchKeys: ["settings.reset.danger_zone.button"],
    aliases: ["reset all", "clear all", "danger zone", "factory reset"],
    destructive: true
  },

  // ---- Permissions & Privacy ---------------------------------------------
  {
    id: "privacy-data-inventory",
    sectionId: "privacy",
    labelKey: "settings.privacy_spine.inventory.title",
    descriptionKey: "settings.privacy_spine.inventory.description",
    searchKeys: [
      "settings.privacy_spine.inventory.chat",
      "settings.privacy_spine.inventory.knowledge",
      "settings.privacy_spine.inventory.settings",
      "settings.privacy_spine.inventory.preferences"
    ],
    aliases: ["local data", "stored data", "privacy", "inventory", "sync"]
  },
  {
    id: "permissions",
    sectionId: "permissions",
    labelKey: "settings.permissions.title",
    descriptionKey: "settings.permissions.description",
    aliases: ["permissions", "privacy", "access", "consent", "data"]
  },
  {
    id: "browser-tab-access",
    sectionId: "permissions",
    labelKey: "settings.presets.fields.tab_access",
    storageKey: STORAGE_KEYS.BROWSER.TABS_ACCESS,
    aliases: [
      "tab access",
      "other tabs",
      "open tabs",
      "read tabs",
      "stop ai seeing tabs"
    ]
  },
  {
    id: "model-tools",
    sectionId: "permissions",
    labelKey: "settings.permissions.tools.title",
    descriptionKey: "settings.permissions.tools.description",
    level: "power",
    searchKeys: [
      "settings.permissions.tools.master.label",
      "settings.permissions.tools.families.browser.label",
      "settings.permissions.tools.families.knowledge.label",
      "settings.permissions.tools.families.history.label",
      "settings.permissions.tools.families.web.label",
      "settings.permissions.tools.families.automation.label",
      "settings.permissions.tools.inventory.title"
    ],
    aliases: [
      "model tools",
      "ai tools",
      "tool calling",
      "function calling",
      "agent",
      "browser tools",
      "available tools",
      "tool inventory"
    ]
  },
  {
    id: "export-allow-remote-images",
    sectionId: "permissions",
    labelKey: "settings.export_privacy.remote_images_label",
    descriptionKey: "settings.export_privacy.remote_images_hint",
    focusId: "export-allow-remote-images",
    storageKey: STORAGE_KEYS.EXPORT.ALLOW_REMOTE_IMAGES,
    aliases: [
      "export images",
      "remote images",
      "print images",
      "pdf images",
      "tracking pixel"
    ]
  },
  {
    id: "tool-approvals",
    sectionId: "permissions",
    labelKey: "settings.permissions.approvals.title",
    descriptionKey: "settings.permissions.approvals.description",
    searchKeys: [
      "settings.permissions.approvals.empty",
      "settings.permissions.approvals.clear_all"
    ],
    aliases: [
      "approvals",
      "always allow",
      "tool permissions",
      "grants",
      "revoke",
      "confirmation"
    ]
  },
  {
    // Routes per-model search hits to the model picker in the Model tools card.
    // focusId must equal the Select's data-settings-focus-id.
    id: "model-tools-per-model",
    sectionId: "permissions",
    labelKey: "settings.permissions.tools.perModel.title",
    descriptionKey: "settings.permissions.tools.perModel.description",
    level: "advanced",
    aliases: ["per model tools", "per-model", "model specific tools"]
  },
  {
    // The non-native fallback toggle mounts under the per-model card once a
    // model is selected; focusId matches its SettingsSwitch id.
    id: "model-tools-nonnative-fallback",
    focusId: "model-tools-override-nonnative-fallback",
    sectionId: "permissions",
    labelKey: "settings.permissions.tools.perModel.nonNativeFallback.label",
    descriptionKey:
      "settings.permissions.tools.perModel.nonNativeFallback.description",
    level: "advanced",
    aliases: [
      "non-native tools",
      "prompt-based tools",
      "tool fallback",
      "react tools",
      "tools without native tool calling"
    ]
  },
  {
    id: "max-restore-sessions",
    sectionId: "permissions",
    labelKey: "settings.restore_sessions.max_label",
    descriptionKey: "settings.restore_sessions.description",
    aliases: [
      "reopen tabs",
      "restore session limit",
      "reopen closed tabs",
      "restore_session",
      "max tabs to reopen"
    ]
  },
  {
    id: "permission-bookmarks",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.bookmarks.label",
    descriptionKey: "settings.permissions.items.bookmarks.description",
    aliases: ["bookmarks", "saved pages", "permission"]
  },
  {
    id: "permission-history",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.history.label",
    descriptionKey: "settings.permissions.items.history.description",
    aliases: ["history", "browsing history", "permission"]
  },
  {
    id: "permission-notifications",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.notifications.label",
    descriptionKey: "settings.permissions.items.notifications.description",
    aliases: ["notifications", "alerts", "permission"]
  },
  {
    id: "permission-downloads",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.downloads.label",
    descriptionKey: "settings.permissions.items.downloads.description",
    aliases: ["downloads", "save file", "export", "permission"]
  },
  // Only register tab groups for search where its focus target actually exists.
  ...(TAB_GROUPS_AVAILABLE
    ? [
        {
          id: "permission-tab-groups",
          sectionId: "permissions",
          labelKey: "settings.permissions.items.tabGroups.label",
          descriptionKey: "settings.permissions.items.tabGroups.description",
          aliases: ["tab groups", "permission"]
        }
      ]
    : []),
  {
    id: "permission-alarms",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.alarms.label",
    descriptionKey: "settings.permissions.items.alarms.description",
    aliases: [
      "alarms",
      "reminders",
      "scheduled jobs",
      "maintenance",
      "permission"
    ]
  },
  {
    id: "permission-sessions",
    sectionId: "permissions",
    labelKey: "settings.permissions.items.sessions.label",
    descriptionKey: "settings.permissions.items.sessions.description",
    aliases: [
      "recently closed tabs",
      "closed tabs",
      "browser sessions",
      "synced tabs",
      "permission"
    ]
  },
  {
    id: "permissions-host",
    sectionId: "permissions",
    labelKey: "settings.permissions.host.title",
    descriptionKey: "settings.permissions.host.description",
    aliases: ["host access", "all urls", "site access", "remote url"]
  },
  {
    id: "scheduled-job-vector-maintenance",
    sectionId: "permissions",
    labelKey: "settings.permissions.scheduled.items.vectorMaintenance.label",
    descriptionKey:
      "settings.permissions.scheduled.items.vectorMaintenance.description",
    level: "advanced",
    aliases: ["scheduled jobs", "maintenance", "alarms", "cleanup"]
  }
] satisfies SettingsEntryDefinition[]

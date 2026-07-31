import { STORAGE_KEYS } from "@/lib/constants"
import type { SettingsEntryDefinition } from "./types"

export const GENERAL_SETTINGS = [
  {
    id: "settings-disclosure-level",
    sectionId: "general",
    labelKey: "settings.disclosure.title",
    descriptionKey: "settings.disclosure.description",
    storageKey: STORAGE_KEYS.UI.SETTINGS_LEVEL,
    aliases: ["basic settings", "power settings", "advanced settings"]
  },
  // ---- General -----------------------------------------------------------
  {
    id: "language-select",
    sectionId: "general",
    labelKey: "common.language.select_label",
    storageKey: STORAGE_KEYS.LANGUAGE,
    aliases: ["language", "locale", "translation"]
  },
  {
    id: "show-session-metrics",
    sectionId: "general",
    labelKey: "settings.chat_display.session_metrics_label",
    descriptionKey: "settings.chat_display.session_metrics_description",
    storageKey: STORAGE_KEYS.CHAT.SHOW_SESSION_METRICS,
    aliases: ["metrics", "tokens", "performance", "stats"]
  },
  {
    id: "settings-presets",
    sectionId: "presets",
    labelKey: "settings.presets.title",
    descriptionKey: "settings.presets.description",
    searchKeys: [
      "settings.presets.fast.label",
      "settings.presets.fast.description",
      "settings.presets.balanced.label",
      "settings.presets.balanced.description",
      "settings.presets.large_context.label",
      "settings.presets.large_context.description",
      "settings.presets.privacy_strict.label",
      "settings.presets.privacy_strict.description"
    ],
    aliases: ["preset", "presets", "profiles", "quick setup"]
  },

  // ---- Voices ------------------------------------------------------------
  {
    id: "voice-selection",
    sectionId: "voices",
    labelKey: "settings.speech.voice_label",
    keywords: ["voice", "tts", "speech"]
  },
  {
    id: "speech-rate",
    sectionId: "voices",
    labelKey: "settings.speech.rate_label",
    keywords: ["rate", "speed", "tts", "speech"]
  },
  {
    id: "speech-pitch",
    sectionId: "voices",
    labelKey: "settings.speech.pitch_label",
    keywords: ["pitch", "tone", "tts", "speech"]
  },

  // ---- Prompts -----------------------------------------------------------
  {
    id: "prompt-templates",
    sectionId: "prompts",
    labelKey: "settings.prompts.title",
    searchKeys: [
      "settings.prompts.new_template",
      "settings.prompts.search_placeholder",
      "settings.prompts.category_placeholder",
      "settings.prompts.all_categories",
      "settings.prompts.sort.recent",
      "settings.prompts.sort.popular",
      "settings.prompts.sort.alphabetical",
      "settings.prompts.empty_state.title",
      "settings.prompts.empty_state.description",
      "settings.prompts.export",
      "settings.prompts.import",
      "settings.prompts.reset",
      "settings.prompts.form.title",
      "settings.prompts.form.category",
      "settings.prompts.form.description",
      "settings.prompts.form.tags",
      "settings.prompts.form.system_prompt",
      "settings.prompts.form.user_prompt",
      "settings.prompts.form.create_button",
      "settings.prompts.variables.title",
      "settings.prompts.variables.description"
    ],
    aliases: ["prompt templates", "templates", "system prompt template"]
  },

  // ---- Shortcuts ---------------------------------------------------------
  {
    id: "browser-shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.browser.title",
    descriptionKey: "settings.shortcuts.browser.description",
    aliases: [
      "global shortcut",
      "open panel hotkey",
      "browser shortcut",
      "side panel"
    ]
  },
  {
    id: "keyboard-shortcuts",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.title",
    descriptionKey: "settings.shortcuts.description",
    searchKeys: [
      "settings.shortcuts.recording",
      "settings.shortcuts.reset_all",
      "settings.shortcuts.new_chat",
      "settings.shortcuts.new_chat_desc",
      "settings.shortcuts.focus_input",
      "settings.shortcuts.focus_input_desc",
      "settings.shortcuts.toggle_sidebar",
      "settings.shortcuts.toggle_sidebar_desc",
      "settings.shortcuts.stop_generation",
      "settings.shortcuts.stop_generation_desc",
      "settings.shortcuts.open_settings",
      "settings.shortcuts.open_settings_desc",
      "settings.shortcuts.toggle_theme",
      "settings.shortcuts.toggle_theme_desc",
      "settings.shortcuts.toggle_rag",
      "settings.shortcuts.toggle_rag_desc",
      "settings.shortcuts.toggle_speech",
      "settings.shortcuts.toggle_speech_desc",
      "settings.shortcuts.toggle_tabs",
      "settings.shortcuts.toggle_tabs_desc",
      "settings.shortcuts.search_messages",
      "settings.shortcuts.search_messages_desc",
      "settings.shortcuts.clear_chat",
      "settings.shortcuts.clear_chat_desc",
      "settings.shortcuts.copy_last_response",
      "settings.shortcuts.copy_last_response_desc",
      "settings.shortcuts.toggle_session_metrics",
      "settings.shortcuts.toggle_session_metrics_desc",
      "settings.shortcuts.export_json",
      "settings.shortcuts.export_json_desc",
      "settings.shortcuts.export_pdf",
      "settings.shortcuts.export_pdf_desc"
    ],
    aliases: ["shortcuts", "keyboard", "hotkeys", "keybindings"]
  },
  {
    id: "shortcut-focus-input",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.focus_input",
    descriptionKey: "settings.shortcuts.focus_input_desc",
    aliases: ["input shortcut", "focus chat input"]
  },
  {
    id: "shortcut-close-sidebar",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_sidebar",
    descriptionKey: "settings.shortcuts.toggle_sidebar_desc",
    aliases: ["sidebar shortcut", "close sidebar"]
  },
  {
    id: "shortcut-settings",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.open_settings",
    descriptionKey: "settings.shortcuts.open_settings_desc",
    aliases: ["settings shortcut", "open settings"]
  },
  {
    id: "shortcut-search-messages",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.search_messages",
    descriptionKey: "settings.shortcuts.search_messages_desc",
    aliases: ["message search shortcut", "semantic chat search"]
  },
  {
    id: "shortcut-new-chat",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.new_chat",
    descriptionKey: "settings.shortcuts.new_chat_desc",
    aliases: ["new chat shortcut"]
  },
  {
    id: "shortcut-stop-generation",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.stop_generation",
    descriptionKey: "settings.shortcuts.stop_generation_desc",
    aliases: ["stop response shortcut"]
  },
  {
    id: "shortcut-clear-chat",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.clear_chat",
    descriptionKey: "settings.shortcuts.clear_chat_desc",
    aliases: ["clear chat shortcut"]
  },
  {
    id: "shortcut-copy-last-response",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.copy_last_response",
    descriptionKey: "settings.shortcuts.copy_last_response_desc",
    aliases: ["copy response shortcut"]
  },
  {
    id: "shortcut-export-json",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.export_json",
    descriptionKey: "settings.shortcuts.export_json_desc",
    aliases: ["json export shortcut"]
  },
  {
    id: "shortcut-export-pdf",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.export_pdf",
    descriptionKey: "settings.shortcuts.export_pdf_desc",
    aliases: ["pdf export shortcut"]
  },
  {
    id: "shortcut-toggle-theme",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_theme",
    descriptionKey: "settings.shortcuts.toggle_theme_desc",
    aliases: ["theme shortcut"]
  },
  {
    id: "shortcut-toggle-rag",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_rag",
    descriptionKey: "settings.shortcuts.toggle_rag_desc",
    aliases: ["rag shortcut", "context retrieval shortcut"]
  },
  {
    id: "shortcut-toggle-speech",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_speech",
    descriptionKey: "settings.shortcuts.toggle_speech_desc",
    aliases: ["speech shortcut", "tts shortcut"]
  },
  {
    id: "shortcut-toggle-tabs",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_tabs",
    descriptionKey: "settings.shortcuts.toggle_tabs_desc",
    aliases: ["tabs shortcut", "tab access shortcut"]
  },
  {
    id: "shortcut-toggle-session-metrics",
    sectionId: "shortcuts",
    labelKey: "settings.shortcuts.toggle_session_metrics",
    descriptionKey: "settings.shortcuts.toggle_session_metrics_desc",
    aliases: ["metrics shortcut", "session metrics shortcut"]
  }
] satisfies SettingsEntryDefinition[]

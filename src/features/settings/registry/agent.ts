import { STORAGE_KEYS } from "@/lib/constants"
import type { SettingsEntryDefinition } from "./types"

export const AGENT_SETTINGS = [
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
  }
] satisfies SettingsEntryDefinition[]

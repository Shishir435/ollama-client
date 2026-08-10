import type { SettingsEntryDefinition } from "./types"

export const MODELS_SETTINGS = [
  // ---- Models: system ----------------------------------------------------
  {
    id: "system-prompt",
    sectionId: "model-system",
    labelKey: "settings.model.system.prompt_label",
    keywords: ["system", "persona", "instructions"]
  },
  {
    id: "stop-sequences",
    sectionId: "model-system",
    labelKey: "settings.model.system.stop_sequences_label",
    keywords: ["stop", "sequences"]
  },

  // ---- Models: sampling parameters (advanced) ----------------------------
  {
    id: "temperature",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.temperature.label",
    advanced: true,
    keywords: ["temperature", "sampling", "randomness", "creativity"]
  },
  {
    id: "top-p",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.top_p.label",
    advanced: true,
    keywords: ["top p", "nucleus", "sampling"]
  },
  {
    id: "top-k",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.top_k.label",
    advanced: true,
    keywords: ["top k", "sampling"]
  },
  {
    id: "min-p",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.min_p.label",
    advanced: true,
    keywords: ["min p", "sampling"]
  },
  {
    id: "seed",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.seed.label",
    advanced: true,
    keywords: ["seed", "deterministic", "reproducible"]
  },
  {
    id: "num-ctx",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.num_ctx.label",
    advanced: true,
    keywords: ["context length", "window", "num_ctx"]
  },
  {
    id: "num-predict",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.num_predict.label",
    advanced: true,
    keywords: ["predictions", "max tokens", "num_predict"]
  },
  {
    id: "repeat-penalty",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.repeat_penalty.label",
    advanced: true,
    keywords: ["repeat", "penalty", "repetition"]
  },
  {
    id: "repeat-last-n",
    sectionId: "model-parameters",
    labelKey: "settings.model.parameters.repeat_last_n.label",
    advanced: true,
    keywords: ["repeat", "last n", "repetition"]
  },

  // ---- Models: runtime ---------------------------------------------------
  {
    id: "keep-alive",
    sectionId: "model-runtime",
    labelKey: "settings.model.runtime.keep_alive_label",
    descriptionKey: "settings.model.runtime.keep_alive_description",
    level: "advanced",
    keywords: ["keep alive", "memory", "unload"]
  },
  {
    id: "warm-on-select",
    sectionId: "model-runtime",
    labelKey: "settings.model.runtime.warm_on_select_label",
    descriptionKey: "settings.model.runtime.warm_on_select_description",
    level: "advanced",
    keywords: ["warm", "preload"]
  },
  {
    id: "unload-on-switch",
    sectionId: "model-runtime",
    labelKey: "settings.model.runtime.unload_on_switch_label",
    descriptionKey: "settings.model.runtime.unload_on_switch_description",
    level: "advanced",
    keywords: ["unload", "memory", "switch"]
  },

  // ---- Providers ---------------------------------------------------------
  {
    id: "provider-picker",
    sectionId: "providers",
    labelKey: "settings.tabs.providers",
    searchKeys: [
      "settings.providers.default",
      "settings.providers.beta_badge",
      "settings.providers.enabled",
      "settings.providers.disabled",
      "settings.providers.inactive",
      "settings.providers.connected",
      "settings.providers.connection_failed",
      "settings.providers.not_tested"
    ],
    aliases: [
      "provider",
      "providers",
      "ollama",
      "lm studio",
      "llama.cpp",
      "vllm",
      "koboldcpp",
      "localai",
      "openai compatible",
      "localhost",
      "remote"
    ]
  },
  {
    id: "provider-add",
    sectionId: "providers",
    labelKey: "settings.providers.add.button",
    descriptionKey: "settings.providers.add.description",
    searchKeys: [
      "settings.providers.add.title",
      "settings.providers.add.wire_openai",
      "settings.providers.add.wire_openai_api",
      "settings.providers.add.wire_ollama",
      "settings.providers.add.wire_anthropic",
      "settings.providers.add.wire_anthropic_compatible",
      "settings.providers.add.wire_openrouter",
      "settings.providers.models.title"
    ],
    aliases: [
      "provider",
      "add provider",
      "custom provider",
      "openai compatible",
      "anthropic",
      "claude",
      "manual model",
      "second ollama",
      "remote server",
      "lan"
    ]
  },
  {
    id: "provider-enabled",
    sectionId: "providers",
    labelKey: "settings.providers.enabled",
    searchKeys: ["settings.providers.disabled"],
    aliases: ["provider", "enable", "disable", "toggle"]
  },
  {
    id: "provider-test-connection",
    sectionId: "providers",
    labelKey: "settings.providers.test",
    searchKeys: [
      "settings.providers.connected",
      "settings.providers.connection_failed",
      "settings.providers.not_tested"
    ],
    aliases: ["provider", "test", "connection", "health", "localhost"]
  },
  {
    id: "provider-base-url",
    sectionId: "providers",
    labelKey: "settings.providers.base_url",
    descriptionKey: "settings.providers.base_url_default",
    searchKeys: ["settings.base_url.title", "settings.base_url.label"],
    aliases: ["provider", "base url", "endpoint", "localhost", "remote"]
  },
  {
    id: "provider-api-key",
    sectionId: "providers",
    labelKey: "settings.providers.api_key",
    aliases: ["provider", "api key", "token", "secret", "remote"]
  },
  {
    id: "provider-icon-lookup",
    sectionId: "providers",
    labelKey: "settings.providers.icon_lookup.label",
    descriptionKey: "settings.providers.icon_lookup.description",
    aliases: [
      "provider",
      "icon",
      "icons",
      "logo",
      "favicon",
      "avatar",
      "branding"
    ]
  },
  {
    id: "provider-catalog-refresh",
    sectionId: "providers",
    labelKey: "settings.providers.catalog_refresh.label",
    descriptionKey: "settings.providers.catalog_refresh.description",
    aliases: [
      "provider",
      "refresh",
      "poll",
      "polling",
      "interval",
      "model list",
      "catalog",
      "network"
    ]
  },
  {
    id: "provider-custom-models",
    sectionId: "providers",
    labelKey: "settings.providers.custom_models",
    descriptionKey: "settings.providers.custom_models_description",
    aliases: ["provider", "custom models", "manual models", "openai compatible"]
  }
] satisfies SettingsEntryDefinition[]

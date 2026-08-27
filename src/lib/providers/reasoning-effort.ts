import type {
  ProviderModel,
  ReasoningEffort,
  ReasoningEffortLevel,
  ReasoningEffortSupport
} from "@/types"
import { type ProviderConfig, ProviderServiceProfile } from "./types"

export const REASONING_EFFORT_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
] as const

export type { ReasoningEffort, ReasoningEffortLevel, ReasoningEffortSupport }

export interface ReportedReasoningSupport {
  supportedEfforts?: Array<ReasoningEffortLevel | "none"> | null
  defaultEffort?: ReasoningEffortLevel | "none"
  defaultEnabled?: boolean
  mandatory?: boolean
}

const ALL_EFFORTS = [...REASONING_EFFORT_LEVELS]
const STANDARD_EFFORTS: ReasoningEffortLevel[] = ["low", "medium", "high"]
const MODERN_OPENAI_EFFORTS: ReasoningEffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh"
]

const hostnameOf = (config: Pick<ProviderConfig, "baseUrl">): string => {
  try {
    return new URL(config.baseUrl || "").hostname.toLowerCase()
  } catch {
    return ""
  }
}

const isHost = (hostname: string, suffix: string): boolean =>
  hostname === suffix || hostname.endsWith(`.${suffix}`)

const support = (
  supportedEfforts: ReasoningEffortLevel[],
  options: Omit<ReasoningEffortSupport, "supportedEfforts" | "source"> = {
    canEnable: supportedEfforts.length === 0,
    canDisable: false
  }
): ReasoningEffortSupport => ({
  supportedEfforts,
  source: "provider-profile",
  ...options
})

const reportedSupport = (
  reported: ReportedReasoningSupport
): ReasoningEffortSupport => {
  const efforts =
    reported.supportedEfforts === null
      ? ALL_EFFORTS
      : (reported.supportedEfforts ?? [])
  const mandatory = reported.mandatory === true
  return {
    supportedEfforts: efforts.filter(
      (effort): effort is ReasoningEffortLevel => effort !== "none"
    ),
    canEnable: true,
    canDisable: !mandatory,
    ...(mandatory ? { mandatory: true } : {}),
    ...(reported.defaultEffort
      ? { defaultEffort: reported.defaultEffort }
      : {}),
    ...(reported.defaultEnabled !== undefined
      ? { defaultEnabled: reported.defaultEnabled }
      : {}),
    source: "model-metadata"
  }
}

const openAIReasoningSupport = (
  rawModel: string
): ReasoningEffortSupport | undefined => {
  const model = rawModel.toLowerCase().replace(/^openai\//, "")
  if (model.includes("-chat")) return undefined

  if (/^gpt-5\.6(?:-|$)/.test(model)) {
    return support([...MODERN_OPENAI_EFFORTS, "max"], {
      canEnable: false,
      canDisable: true,
      defaultEffort: "medium"
    })
  }
  if (/^gpt-5\.[245]-pro(?:-|$)/.test(model)) {
    return support(["medium", "high", "xhigh"], {
      canEnable: false,
      canDisable: false,
      defaultEffort: "high"
    })
  }
  if (/^gpt-5\.[45](?:-|$)/.test(model)) {
    return support(MODERN_OPENAI_EFFORTS, {
      canEnable: false,
      canDisable: true
    })
  }
  if (/^gpt-5\.2(?:-|$)/.test(model)) {
    return support(MODERN_OPENAI_EFFORTS, {
      canEnable: false,
      canDisable: true,
      defaultEffort: "none"
    })
  }
  if (/^gpt-5\.1(?:-|$)/.test(model)) {
    return support(["low", "medium", "high"], {
      canEnable: false,
      canDisable: true,
      defaultEffort: "none"
    })
  }
  if (/^gpt-5-pro(?:-|$)/.test(model) || /^o[13]-pro(?:-|$)/.test(model)) {
    return support(["high"], {
      canEnable: false,
      canDisable: false,
      mandatory: true,
      defaultEffort: "high"
    })
  }
  if (/^gpt-5(?:-mini|-nano)?(?:-|$)/.test(model)) {
    return support(["minimal", ...STANDARD_EFFORTS], {
      canEnable: false,
      canDisable: false
    })
  }
  if (/^(?:o3|o4-mini)(?:-|$)/.test(model)) {
    return support(STANDARD_EFFORTS, {
      canEnable: false,
      canDisable: false
    })
  }
  if (/^gpt-oss-(?:20b|120b)(?:-|$)/.test(model)) {
    return support(STANDARD_EFFORTS, {
      canEnable: false,
      canDisable: false
    })
  }
  return undefined
}

const anthropicReasoningSupport = (
  rawModel: string
): ReasoningEffortSupport | undefined => {
  const model = rawModel.toLowerCase().replace(/^anthropic\//, "")
  if (!model.startsWith("claude-")) return undefined

  if (/claude-(?:fable|mythos|opus|sonnet)-5(?:-|$)/.test(model)) {
    return support(["low", "medium", "high", "xhigh", "max"], {
      canEnable: false,
      canDisable: false,
      defaultEffort: "high"
    })
  }
  if (/claude-(?:opus-4-[678]|sonnet-4-6)(?:-|$)/.test(model)) {
    const supportsXhigh = /claude-opus-4-[78](?:-|$)/.test(model)
    return support(
      supportsXhigh
        ? ["low", "medium", "high", "xhigh", "max"]
        : ["low", "medium", "high", "max"],
      {
        canEnable: false,
        canDisable: false,
        defaultEffort: "high"
      }
    )
  }
  if (/claude-opus-4-5(?:-|$)/.test(model)) {
    return support(STANDARD_EFFORTS, {
      canEnable: false,
      canDisable: false,
      defaultEffort: "high"
    })
  }
  if (/claude-mythos-preview(?:-|$)/.test(model)) {
    return support(["low", "medium", "high", "max"], {
      canEnable: false,
      canDisable: false,
      defaultEffort: "high"
    })
  }
  return undefined
}

const deepSeekReasoningSupport = (
  normalizedModel: string
): ReasoningEffortSupport =>
  /^deepseek-v4-(?:flash|pro)(?:-|$)/.test(normalizedModel)
    ? support(["high", "max"], {
        canEnable: true,
        canDisable: true,
        defaultEffort: "high",
        defaultEnabled: true
      })
    : support([], { canEnable: true, canDisable: true })

const togetherReasoningSupport = (
  normalizedModel: string
): ReasoningEffortSupport | undefined => {
  if (normalizedModel.includes("gpt-oss")) {
    return support(STANDARD_EFFORTS, {
      canEnable: false,
      canDisable: false
    })
  }
  if (normalizedModel.includes("deepseek-v4")) {
    return support(["high", "max"], { canEnable: true, canDisable: true })
  }
  return undefined
}

const zaiReasoningSupport = (
  normalizedModel: string
): ReasoningEffortSupport | undefined =>
  /(?:^|\/)glm-(?:4\.[5-9]|[5-9])/.test(normalizedModel)
    ? support([], { canEnable: true, canDisable: true })
    : undefined

const upstreamRouterSupport = (
  model: string,
  normalizedModel: string
): ReasoningEffortSupport | undefined =>
  openAIReasoningSupport(model) ??
  anthropicReasoningSupport(model) ??
  (normalizedModel.includes("deepseek-v4")
    ? support(["high", "max"], { canEnable: true, canDisable: true })
    : undefined)

const zenmuxReasoningSupport = (
  model: string,
  normalizedModel: string
): ReasoningEffortSupport | undefined => {
  const upstream = upstreamRouterSupport(model, normalizedModel)
  if (!upstream) return undefined
  return support(
    upstream.supportedEfforts.filter(
      (effort) =>
        effort === "minimal" ||
        effort === "low" ||
        effort === "medium" ||
        effort === "high"
    ),
    { canEnable: true, canDisable: true }
  )
}

const isRouterHost = (hostname: string): boolean =>
  isHost(hostname, "openrouter.ai") ||
  isHost(hostname, "api.trustedrouter.com") ||
  isHost(hostname, "api.quillrouter.com")

/**
 * Resolve the control a settings UI can honestly offer. Live per-model catalog
 * metadata wins; provider/model rules are deliberately conservative fallbacks.
 */
export const resolveReasoningEffortSupport = (
  config: Pick<ProviderConfig, "baseUrl" | "serviceProfile" | "type">,
  model: string,
  reported?: ReportedReasoningSupport
): ReasoningEffortSupport | undefined => {
  const hostname = hostnameOf(config)
  const normalizedModel = model.toLowerCase()
  const isAnthropic =
    config.serviceProfile === ProviderServiceProfile.ANTHROPIC ||
    isHost(hostname, "api.anthropic.com")

  if (reported) {
    const resolved = reportedSupport(reported)
    return isAnthropic
      ? { ...resolved, canDisable: anthropicSupportsAdaptiveThinking(model) }
      : resolved
  }
  if (
    config.serviceProfile === ProviderServiceProfile.OPENAI ||
    isHost(hostname, "api.openai.com")
  ) {
    return openAIReasoningSupport(model)
  }
  if (isAnthropic) return anthropicReasoningSupport(model)
  if (isHost(hostname, "api.deepseek.com")) {
    return deepSeekReasoningSupport(normalizedModel)
  }
  if (isHost(hostname, "api.together.xyz")) {
    return togetherReasoningSupport(normalizedModel)
  }
  if (isHost(hostname, "api.z.ai") || isHost(hostname, "open.bigmodel.cn")) {
    return zaiReasoningSupport(normalizedModel)
  }
  if (isHost(hostname, "zenmux.ai")) {
    return zenmuxReasoningSupport(model, normalizedModel)
  }
  if (
    config.serviceProfile === ProviderServiceProfile.OPENROUTER ||
    isRouterHost(hostname)
  ) {
    return upstreamRouterSupport(model, normalizedModel)
  }
  return undefined
}

export const withReasoningEffortSupport = (
  model: ProviderModel,
  config: ProviderConfig
): ProviderModel => {
  if (model.capabilityHints?.reasoning) return model
  if (hasAuthoritativeReasoningCatalog(config)) return model
  const reasoning = resolveReasoningEffortSupport(config, model.model)
  if (!reasoning) return model
  return {
    ...model,
    capabilityHints: { ...model.capabilityHints, reasoning }
  }
}

export const hasAuthoritativeReasoningCatalog = (
  config: Pick<ProviderConfig, "baseUrl" | "serviceProfile">
): boolean => {
  const hostname = hostnameOf(config)
  return (
    config.serviceProfile === ProviderServiceProfile.OPENROUTER ||
    config.serviceProfile === ProviderServiceProfile.ANTHROPIC ||
    isHost(hostname, "openrouter.ai") ||
    isHost(hostname, "api.anthropic.com")
  )
}

export type OpenAIReasoningWire =
  | "openai"
  | "router"
  | "deepseek"
  | "together"
  | "zai"

export const resolveOpenAIReasoningWire = (
  config: ProviderConfig
): OpenAIReasoningWire => {
  const hostname = hostnameOf(config)
  if (isHost(hostname, "api.deepseek.com")) return "deepseek"
  if (isHost(hostname, "api.together.xyz")) return "together"
  if (isHost(hostname, "api.z.ai") || isHost(hostname, "open.bigmodel.cn")) {
    return "zai"
  }
  if (
    config.serviceProfile === ProviderServiceProfile.OPENROUTER ||
    isRouterHost(hostname) ||
    isHost(hostname, "zenmux.ai")
  ) {
    return "router"
  }
  return "openai"
}

export const buildOpenAIReasoningFields = (
  config: ProviderConfig,
  effort: ReasoningEffort | undefined
): Record<string, unknown> => {
  if (!effort || effort === "auto") return {}
  const wire = resolveOpenAIReasoningWire(config)

  if (wire === "router") {
    return effort === "enabled"
      ? { reasoning: { enabled: true } }
      : { reasoning: { effort } }
  }
  if (wire === "deepseek") {
    return effort === "none"
      ? { thinking: { type: "disabled" } }
      : {
          thinking: { type: "enabled" },
          ...(effort !== "enabled" ? { reasoning_effort: effort } : {})
        }
  }
  if (wire === "together") {
    return effort === "none"
      ? { reasoning: { enabled: false } }
      : effort === "enabled"
        ? { reasoning: { enabled: true } }
        : { reasoning_effort: effort }
  }
  if (wire === "zai") {
    return {
      thinking: { type: effort === "none" ? "disabled" : "enabled" }
    }
  }
  return effort === "enabled" ? {} : { reasoning_effort: effort }
}

export const isReasoningEffortActive = (
  effort: ReasoningEffort | undefined,
  config?: Pick<ProviderConfig, "baseUrl" | "serviceProfile" | "type">,
  model?: string
): boolean => {
  if (effort && effort !== "auto") return effort !== "none"
  if (!config || !model) return false
  const resolved = resolveReasoningEffortSupport(config, model)
  return (
    resolved?.mandatory === true ||
    (resolved?.defaultEffort !== undefined &&
      resolved.defaultEffort !== "none") ||
    resolved?.defaultEnabled === true
  )
}

export const toOllamaThink = (
  effort: ReasoningEffort | undefined
): boolean | "low" | "medium" | "high" | "max" | undefined => {
  switch (effort) {
    case undefined:
    case "auto":
      return undefined
    case "enabled":
      return true
    case "none":
      return false
    case "minimal":
      return "low"
    case "xhigh":
      return "high"
    default:
      return effort
  }
}

export const anthropicSupportsAdaptiveThinking = (model: string): boolean => {
  const normalized = model.toLowerCase().replace(/^anthropic\//, "")
  return (
    /claude-(?:fable|mythos|opus|sonnet)-5(?:-|$)/.test(normalized) ||
    /claude-(?:opus-4-[678]|sonnet-4-6)(?:-|$)/.test(normalized) ||
    /claude-mythos-preview(?:-|$)/.test(normalized)
  )
}

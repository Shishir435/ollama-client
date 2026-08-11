import { ProviderId, ProviderServiceProfile } from "./types"

/**
 * Vendors we can identify well enough to show their own mark. A brand is a
 * display concern only: nothing about routing, capabilities, or the wire
 * format is derived from it, so an unrecognized provider is a normal provider
 * that falls back to a generic glyph.
 */
export const PROVIDER_BRANDS = [
  "ollama",
  "lm-studio",
  "openai",
  "anthropic",
  "openrouter",
  "deepseek",
  "zhipu",
  "moonshot",
  "mistral",
  "groq",
  "together",
  "xai",
  "gemini",
  "perplexity",
  "qwen",
  "vllm"
] as const

export type ProviderBrandId = (typeof PROVIDER_BRANDS)[number]

const BRAND_SET = new Set<string>(PROVIDER_BRANDS)

export const isProviderBrandId = (value?: string): value is ProviderBrandId =>
  Boolean(value) && BRAND_SET.has(value as string)

/**
 * Registrable domains, matched against the configured base URL. Hosted vendors
 * are identified this way rather than by service profile, because the profile
 * describes the wire dialect a server speaks — most of these answer
 * `openai` — while the host names the vendor.
 */
const BRAND_HOSTS: ReadonlyArray<readonly [ProviderBrandId, string[]]> = [
  ["openai", ["openai.com", "openai.azure.com"]],
  ["anthropic", ["anthropic.com", "claude.com"]],
  ["openrouter", ["openrouter.ai"]],
  ["deepseek", ["deepseek.com"]],
  ["zhipu", ["bigmodel.cn", "z.ai", "zhipuai.cn"]],
  ["moonshot", ["moonshot.cn", "moonshot.ai", "kimi.com"]],
  ["mistral", ["mistral.ai"]],
  ["groq", ["groq.com"]],
  ["together", ["together.xyz", "together.ai"]],
  ["xai", ["x.ai"]],
  ["gemini", ["generativelanguage.googleapis.com"]],
  ["perplexity", ["perplexity.ai"]],
  ["qwen", ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"]]
]

/**
 * Name fragments, matched last. A self-hosted server has no vendor host — a
 * vLLM instance is `http://localhost:8000` — so the display name the user typed
 * is the only signal left. Fragments are deliberately distinctive: a match on
 * something as generic as "ai" would mislabel more providers than it labels.
 */
const BRAND_NAME_TOKENS: ReadonlyArray<readonly [ProviderBrandId, string[]]> = [
  ["ollama", ["ollama"]],
  ["lm-studio", ["lmstudio", "lm studio"]],
  ["vllm", ["vllm"]],
  ["openrouter", ["openrouter", "open router"]],
  ["openai", ["openai", "open ai", "chatgpt"]],
  ["anthropic", ["anthropic", "claude"]],
  ["deepseek", ["deepseek", "deep seek"]],
  ["zhipu", ["zhipu", "bigmodel", "glm", "z.ai"]],
  ["moonshot", ["moonshot", "kimi"]],
  ["mistral", ["mistral"]],
  ["groq", ["groq"]],
  ["together", ["together"]],
  ["xai", ["xai", "x.ai", "grok"]],
  ["gemini", ["gemini", "google ai", "vertex"]],
  ["perplexity", ["perplexity"]],
  ["qwen", ["qwen", "dashscope", "tongyi"]]
]

const PROFILE_BRANDS: Partial<Record<ProviderServiceProfile, ProviderBrandId>> =
  {
    [ProviderServiceProfile.OPENAI]: "openai",
    [ProviderServiceProfile.ANTHROPIC]: "anthropic",
    [ProviderServiceProfile.OPENROUTER]: "openrouter"
  }

const BUILT_IN_BRANDS: Record<string, ProviderBrandId> = {
  [ProviderId.OLLAMA]: "ollama",
  [ProviderId.LM_STUDIO]: "lm-studio"
}

const hostOf = (baseUrl?: string): string | undefined => {
  const raw = baseUrl?.trim()
  if (!raw) return undefined
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
    )
    return url.hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return undefined
  }
}

const matchesHost = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)

export interface ProviderBrandInput {
  id?: string
  baseUrl?: string
  name?: string
  serviceProfile?: ProviderServiceProfile
}

/**
 * Resolve the vendor mark for a provider, strongest signal first: a built-in
 * id, then the base-URL host, then the declared service profile, then the
 * display name. Host beats profile because a DeepSeek or Groq endpoint is
 * configured as an OpenAI-compatible one and would otherwise wear OpenAI's
 * mark.
 */
export const resolveProviderBrand = ({
  id,
  baseUrl,
  name,
  serviceProfile
}: ProviderBrandInput): ProviderBrandId | undefined => {
  if (id && BUILT_IN_BRANDS[id]) return BUILT_IN_BRANDS[id]

  const host = hostOf(baseUrl)
  if (host) {
    const hosted = BRAND_HOSTS.find(([, domains]) =>
      domains.some((domain) => matchesHost(host, domain))
    )
    if (hosted) return hosted[0]
  }

  const profileBrand = serviceProfile && PROFILE_BRANDS[serviceProfile]
  if (profileBrand) return profileBrand

  const normalized = name?.trim().toLowerCase()
  if (!normalized) return undefined
  return BRAND_NAME_TOKENS.find(([, tokens]) =>
    tokens.some((token) => normalized.includes(token))
  )?.[0]
}

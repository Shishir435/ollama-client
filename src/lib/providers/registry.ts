import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import type { LucideIcon } from "@/lib/lucide-icon"
import { Bot, Cpu, Server, Sparkles } from "@/lib/lucide-icon"
import { ProviderId } from "./types"

export type ProviderIcon =
  | { kind: "lucide"; icon: LucideIcon }
  | { kind: "asset"; src: string; alt: string }

export interface ProviderMeta {
  id: string
  displayName: string
  icon: ProviderIcon
}

export const PROVIDER_ICON_SIZES = {
  sm: 16,
  md: 20,
  lg: 24
} as const

const FALLBACK_PROVIDER_META: ProviderMeta = {
  id: "unknown",
  displayName: "Local Provider",
  icon: { kind: "lucide", icon: Server }
}

export const PROVIDER_REGISTRY: Record<string, ProviderMeta> = {
  [ProviderId.OLLAMA]: {
    id: ProviderId.OLLAMA,
    displayName: "Ollama",
    icon: { kind: "lucide", icon: Sparkles }
  },
  [ProviderId.LM_STUDIO]: {
    id: ProviderId.LM_STUDIO,
    displayName: "LM Studio",
    icon: { kind: "lucide", icon: Cpu }
  },
  [ProviderId.LLAMA_CPP]: {
    id: ProviderId.LLAMA_CPP,
    displayName: "llama.cpp",
    icon: { kind: "lucide", icon: Bot }
  }
}

export const getProviderMeta = (id?: string): ProviderMeta => {
  if (!id) {
    return PROVIDER_REGISTRY[DEFAULT_PROVIDER_ID] || FALLBACK_PROVIDER_META
  }

  return PROVIDER_REGISTRY[id] || FALLBACK_PROVIDER_META
}

export const getProviderDisplayName = (id?: string): string =>
  getProviderMeta(id).displayName

export const getProviderIcon = (id?: string): ProviderIcon =>
  getProviderMeta(id).icon

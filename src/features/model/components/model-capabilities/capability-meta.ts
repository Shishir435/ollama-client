import {
  Brain,
  Code,
  Database,
  Eye,
  type LucideIcon,
  MessageSquare
} from "@/lib/lucide-icon"
import type { ModelCapabilities } from "@/lib/providers/capabilities"

export type CapabilityFlag =
  | "text"
  | "vision"
  | "embeddings"
  | "toolCalling"
  | "reasoning"

export interface CapabilityMeta {
  flag: CapabilityFlag
  icon: LucideIcon
  labelKey: string
  descKey: string
}

/** Display order + icon/label/description i18n keys for each capability flag. */
export const CAPABILITY_META: CapabilityMeta[] = [
  {
    flag: "text",
    icon: MessageSquare,
    labelKey: "model.capabilities.flags.text.label",
    descKey: "model.capabilities.flags.text.desc"
  },
  {
    flag: "vision",
    icon: Eye,
    labelKey: "model.capabilities.flags.vision.label",
    descKey: "model.capabilities.flags.vision.desc"
  },
  {
    flag: "toolCalling",
    icon: Code,
    labelKey: "model.capabilities.flags.toolCalling.label",
    descKey: "model.capabilities.flags.toolCalling.desc"
  },
  {
    flag: "reasoning",
    icon: Brain,
    labelKey: "model.capabilities.flags.reasoning.label",
    descKey: "model.capabilities.flags.reasoning.desc"
  },
  {
    flag: "embeddings",
    icon: Database,
    labelKey: "model.capabilities.flags.embeddings.label",
    descKey: "model.capabilities.flags.embeddings.desc"
  }
]

/**
 * Capabilities surfaced as badges on a model row, in display order. Mirrors the
 * chips Ollama shows in Model Information (completion, vision, tools, thinking),
 * plus embeddings for embedding models.
 */
export const BADGE_FLAGS: CapabilityFlag[] = [
  "text",
  "vision",
  "toolCalling",
  "reasoning",
  "embeddings"
]

export const capabilityFlagValue = (
  caps: ModelCapabilities,
  flag: CapabilityFlag
): boolean => caps[flag]

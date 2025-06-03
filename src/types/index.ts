import type { LucideIcon } from "lucide-react"

export type OllamaModel = {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

export type ModelConfig = {
  temperature: number
  top_k: number
  top_p: number
  repeat_penalty: number
  stop: string[]
  system_prompt: string
}

export type ModelConfigMap = Record<string, ModelConfig>

export interface SocialLink {
  label: string
  href: string
  icon: LucideIcon
}

export type Role = "user" | "assistant"

export interface ChatMessage {
  role: Role
  content: string
  done?: boolean
  model?: string
}

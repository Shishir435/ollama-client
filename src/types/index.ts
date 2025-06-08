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
  stop: any[]
  system: string
  num_ctx: number
  repeat_last_n: number
  seed: number
  num_predict: number
  min_p: number
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
  metrics?: {
    total_duration?: number
    load_duration?: number
    prompt_eval_count?: number
    prompt_eval_duration?: number
    eval_count?: number
    eval_duration?: number
  }
}

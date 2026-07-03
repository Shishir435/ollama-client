import {
  Clock,
  Database,
  FileText,
  Globe,
  Hash,
  Layers,
  type LucideIcon,
  MessageSquare,
  RefreshCw,
  Scissors,
  Search,
  Shield,
  Sparkles
} from "@/lib/lucide-icon"
import type { SettingWrite } from "./apply-settings"

export interface PresetFieldMeta {
  icon: LucideIcon
  /** Optional label override (i18n key); otherwise the label is humanized. */
  labelKey?: string
  /** Optional one-line description (i18n key) shown under the label. */
  descriptionKey?: string
}

const F = "settings.presets.fields"

/**
 * Per-setting display metadata for the change-preview dialog, keyed by the
 * storage key (scalar) or `storageKey.field` (config-object field). Provides an
 * icon and, for the settings presets actually touch, a short description so the
 * preview reads like a settings screen rather than a key dump. Anything missing
 * falls back to a humanized label, no description, and a neutral icon.
 */
const META: Record<string, PresetFieldMeta> = {
  // Privacy / access
  "browser-tab-access": { icon: Layers, descriptionKey: `${F}.tab_access` },
  "chat-grounded-only-mode": {
    icon: Shield,
    descriptionKey: `${F}.grounded_only`
  },
  "chat-auto-refresh-tab-context": {
    icon: RefreshCw,
    descriptionKey: `${F}.auto_refresh_tab`
  },
  "embeddings-auto-embed-chat": {
    icon: MessageSquare,
    descriptionKey: `${F}.auto_embed_chat`
  },
  "global-auto-embed-enabled": {
    icon: Database,
    descriptionKey: `${F}.global_auto_embed`
  },
  "web-search-config.enabled": {
    icon: Globe,
    labelKey: `${F}.web_search_label`,
    descriptionKey: `${F}.web_search`
  },
  // Prompt budget
  "chat-max-tab-context-chars": {
    icon: Hash,
    descriptionKey: `${F}.max_tab_chars`
  },
  "chat-max-rag-context-chars": {
    icon: Hash,
    descriptionKey: `${F}.max_rag_chars`
  },
  "chat-max-tool-result-chars": {
    icon: Hash,
    descriptionKey: `${F}.max_tool_chars`
  },
  // Retrieval
  "embeddings-config.useReranking": {
    icon: Search,
    descriptionKey: `${F}.use_reranking`
  },
  "embeddings-config.defaultSearchLimit": {
    icon: Search,
    descriptionKey: `${F}.search_limit`
  },
  "embeddings-config.minRerankScore": {
    icon: Search,
    descriptionKey: `${F}.min_rerank`
  },
  // Chunking
  "embeddings-config.chunkSize": {
    icon: Scissors,
    descriptionKey: `${F}.chunk_size`
  },
  "embeddings-config.chunkOverlap": {
    icon: Scissors,
    descriptionKey: `${F}.chunk_overlap`
  },
  "embeddings-config.chunkingStrategy": {
    icon: Scissors,
    descriptionKey: `${F}.chunking_strategy`
  },
  // Reset-only fields — icons only (descriptions fall back to none)
  "embeddings-config.maxEmbeddingsPerFile": { icon: Database },
  "embeddings-config.maxStorageSize": { icon: Database },
  "embeddings-config.autoCleanup": { icon: Database },
  "embeddings-config.cleanupDaysOld": { icon: Clock },
  "image-max-size-mb": { icon: FileText },
  "file-upload-config.maxFileSize": { icon: FileText }
}

const DEFAULT_META: PresetFieldMeta = { icon: Sparkles }

/** Resolve display metadata for a settings write. */
export const getPresetFieldMeta = (write: SettingWrite): PresetFieldMeta => {
  const key = write.field
    ? `${write.storageKey}.${write.field}`
    : write.storageKey
  return META[key] ?? DEFAULT_META
}

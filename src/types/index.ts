/**
 * Convenience re-export for embedding configuration. New code should prefer
 * its specific domain module instead of expanding this compatibility barrel.
 */
export type { ChunkingStrategy, EmbeddingConfig } from "@/lib/constants"
export * from "./chat"
export * from "./content-extraction"
export * from "./errors"
export * from "./messaging"
export * from "./model"
export * from "./ui-state"

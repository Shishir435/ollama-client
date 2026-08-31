// Type declarations for the plain-JS docs IA consumed by build tooling
// (tools/generate/generate-llms-docs.ts) under the strict root tsconfig.
export type DocIaItem = {
  label: string
  slug: string
  /** Written by tools/generate/generate-docs.ts and gitignored, not committed. */
  generated?: boolean
}

export type DocIaSection = {
  label: string
  items: DocIaItem[]
}

export const DOC_SECTIONS: DocIaSection[]
export const DOC_ORDER: string[]
export const GENERATED_DOC_SLUGS: string[]
export const SECTION_LABELS: Record<string, string>
export function withReferenceGroup<T>(referenceGroup: T): (DocIaSection | T)[]

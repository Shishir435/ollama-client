// Type declarations for the plain-JS docs IA consumed by build tooling
// (tools/generate-llms-docs.ts) under the strict root tsconfig.
export type DocIaItem = {
  label: string
  slug: string
}

export type DocIaSection = {
  label: string
  items: DocIaItem[]
}

export const DOC_SECTIONS: DocIaSection[]
export const DOC_ORDER: string[]
export const SECTION_LABELS: Record<string, string>
export function withReferenceGroup<T>(referenceGroup: T): (DocIaSection | T)[]

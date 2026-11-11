export interface SourceItem {
  partial?: boolean
  id: string | number
  /** Real chunk vector id for feedback — `id` may be a compound React key. */
  chunkId?: string | number
  title: string
  content: string
  score: number
  chunkIndex?: number
  source?: string
  sectionPath?: string
  kind?: "page" | "knowledge" | "web"
  url?: string
  engine?: string
  publishedAt?: string
}

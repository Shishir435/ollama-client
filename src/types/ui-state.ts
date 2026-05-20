export type Theme = "dark" | "light" | "system"

export interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export interface SelectedTabsState {
  selectedTabIds: string[]
  errors: Record<number, string>
  setSelectedTabIds: (tabs: string[]) => void
  setErrors: (
    errors:
      | Record<number, string>
      | ((prev: Record<number, string>) => Record<number, string>)
  ) => void
}

export interface TabContentState {
  builtContent: string
  documents: Array<{ id: string; title: string; content: string }>
  setBuiltContent: (builtContent: string) => void
  setDocuments: (
    documents: Array<{ id: string; title: string; content: string }>
  ) => void
}

export type PromptTemplate = {
  id: string
  title: string
  description?: string
  category?: string
  systemPrompt?: string
  userPrompt: string
  tags?: string[]
  createdAt?: Date
  usageCount?: number
}

export interface FileUploadConfig {
  maxFileSize: number // Maximum file size in bytes
  autoEmbedFiles: boolean // Auto-generate embeddings for uploaded files
  showEmbeddingProgress: boolean // Show progress during embedding generation
  embeddingBatchSize: number // Number of chunks to embed in parallel
}

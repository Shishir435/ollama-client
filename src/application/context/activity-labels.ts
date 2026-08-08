/**
 * App-generated labels for activity-trace events and derived context chunks.
 *
 * Services emit the key plus the English text: the key is what presentation
 * renders, and the text stays as the fallback for an event persisted before its
 * key existed and for non-React hosts with no translator. Adding one here means
 * adding the key to every `src/locales/<lang>/translation.json`.
 */
export interface ActivityLabel {
  key: string
  text: string
}

export const ACTIVITY_LABELS = {
  preparingContext: {
    key: "chat.reasoning.trace.preparing",
    text: "Preparing context"
  },
  rewritingQuery: {
    key: "chat.reasoning.trace.rewriting_query",
    text: "Rewriting query"
  },
  readingPageContext: {
    key: "chat.reasoning.trace.page_context",
    text: "Reading selected page context"
  },
  searchingFiles: {
    key: "chat.reasoning.trace.documents",
    text: "Searching files"
  },
  searchingMemory: {
    key: "chat.reasoning.trace.searching_memory",
    text: "Searching memory"
  },
  searchingContext: {
    key: "chat.reasoning.trace.searching_context",
    text: "Searching context"
  }
} as const satisfies Record<string, ActivityLabel>

export const CONTEXT_CHUNK_LABELS = {
  selectedTabContext: {
    key: "chat.sources.tab_context",
    text: "Selected tab context"
  }
} as const satisfies Record<string, ActivityLabel>

export const ACTIVITY_TEXTS = {
  noMatchingPageChunks: {
    key: "chat.reasoning.trace.no_matching_page_chunks",
    text: "No matching page chunks"
  },
  noMatchingFileChunks: {
    key: "chat.reasoning.trace.no_matching_file_chunks",
    text: "No matching file chunks"
  },
  recalledPastConversation: {
    key: "chat.reasoning.trace.recalled_past_conversation",
    text: "Recalled past conversation context"
  },
  noMatchingMemory: {
    key: "chat.reasoning.trace.no_matching_memory",
    text: "No matching memory"
  },
  previousConversation: {
    key: "chat.reasoning.trace.previous_conversation",
    text: "Previous conversation"
  },
  memory: {
    key: "chat.reasoning.trace.memory",
    text: "Memory"
  }
} as const satisfies Record<string, ActivityLabel>

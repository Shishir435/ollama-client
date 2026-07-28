interface ContextSummaryInput {
  tabAccess: boolean
  selectedTabCount: number
  attachmentCount: number
  useRAG: boolean
  webSearchActive: boolean
  showWebSearch: boolean
}

/**
 * One line naming what the model will actually receive with the next message.
 *
 * Three independent sources, joined in the order they reach the prompt: page or
 * tabs, then files or knowledge, then web search. Attachments displace the
 * knowledge label rather than adding to it, because staged files are what RAG
 * would retrieve from — showing both reads as two separate context sources.
 */
export const buildContextSummary = (
  {
    tabAccess,
    selectedTabCount,
    attachmentCount,
    useRAG,
    webSearchActive,
    showWebSearch
  }: ContextSummaryInput,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  const parts = [
    tabAccess
      ? selectedTabCount > 0
        ? t("chat.context.tabs", { count: selectedTabCount })
        : t("chat.context.page")
      : null,
    attachmentCount > 0
      ? t("chat.context.files", { count: attachmentCount })
      : useRAG
        ? t("chat.context.knowledge")
        : null,
    showWebSearch && webSearchActive ? t("chat.context.web") : null
  ].filter((label): label is string => Boolean(label))

  return parts.length > 0 ? parts.join(" · ") : t("chat.context.none")
}

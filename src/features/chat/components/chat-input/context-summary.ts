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
const contextParts = <T>(
  {
    tabAccess,
    selectedTabCount,
    attachmentCount,
    useRAG,
    webSearchActive,
    showWebSearch
  }: ContextSummaryInput,
  label: {
    tabs: (count: number) => T
    page: () => T
    files: (count: number) => T
    knowledge: () => T
    web: () => T
  }
): T[] =>
  [
    tabAccess
      ? selectedTabCount > 0
        ? label.tabs(selectedTabCount)
        : label.page()
      : null,
    attachmentCount > 0
      ? label.files(attachmentCount)
      : useRAG
        ? label.knowledge()
        : null,
    showWebSearch && webSearchActive ? label.web() : null
  ].filter((part): part is T => part !== null)

export const buildContextSummary = (
  input: ContextSummaryInput,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  const parts = contextParts<string>(input, {
    tabs: (count) => t("chat.context.tabs", { count }),
    page: () => t("chat.context.page"),
    files: (count) => t("chat.context.files", { count }),
    knowledge: () => t("chat.context.knowledge"),
    web: () => t("chat.context.web")
  })

  return parts.length > 0 ? parts.join(" · ") : t("chat.context.none")
}

/**
 * How many sources the next message will carry, for the badge on the context
 * control.
 *
 * The same three the summary names, counted rather than written out, so the
 * badge and the sentence inside the sheet can never disagree about whether
 * anything is attached. Zero is a real answer and is shown as one: the point
 * of the badge is to be readable without opening anything, and a control that
 * only marks itself when something is set leaves "nothing attached" and "I
 * have not looked" identical.
 */
export const countContextSources = (input: ContextSummaryInput): number =>
  contextParts<true>(input, {
    tabs: () => true,
    page: () => true,
    files: () => true,
    knowledge: () => true,
    web: () => true
  }).length

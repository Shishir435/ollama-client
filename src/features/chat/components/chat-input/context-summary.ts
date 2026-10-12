interface ContextSummaryInput {
  tabAccess: boolean
  selectedTabCount: number
  /** Staged documents: what file search would retrieve from. */
  fileCount: number
  /** Attached images and screenshots, which reach the model as they are. */
  imageCount: number
  useRAG: boolean
  webSearchActive: boolean
  showWebSearch: boolean
}

/**
 * What the model will actually receive with the next message, in the order it
 * reaches the prompt: page or tabs, then files or knowledge, then images, then
 * web search.
 *
 * Staged files displace the knowledge label rather than adding to it, because
 * they are what file search would retrieve from — showing both reads as two
 * separate sources. Images do not: file search never retrieves an image, so
 * an attached screenshot is context of its own, beside knowledge, and hiding
 * knowledge behind it said a source was off that was still on.
 */
const contextParts = <T>(
  {
    tabAccess,
    selectedTabCount,
    fileCount,
    imageCount,
    useRAG,
    webSearchActive,
    showWebSearch
  }: ContextSummaryInput,
  label: {
    tabs: (count: number) => T
    page: () => T
    files: (count: number) => T
    knowledge: () => T
    images: (count: number) => T
    web: () => T
  }
): T[] =>
  [
    tabAccess
      ? selectedTabCount > 0
        ? label.tabs(selectedTabCount)
        : label.page()
      : null,
    fileCount > 0 ? label.files(fileCount) : useRAG ? label.knowledge() : null,
    imageCount > 0 ? label.images(imageCount) : null,
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
    images: (count) => t("chat.context.images", { count }),
    web: () => t("chat.context.web")
  })

  return parts.length > 0 ? parts.join(" · ") : t("chat.context.none")
}

/**
 * How many context items the next message will carry, for the badge on the
 * context control.
 *
 * Each attachment is one item — four images are 4, not one "images" source —
 * so the badge moves the moment an image is added. The page, tabs, knowledge
 * and web search are one item each. The parts are the ones the summary
 * names, so the badge and the sentence inside the sheet never disagree about
 * what is attached. Zero is a real answer and is shown as one: the point of
 * the badge is to be readable without opening anything.
 */
export const countContextSources = (input: ContextSummaryInput): number =>
  contextParts<number>(input, {
    tabs: () => 1,
    page: () => 1,
    files: (count) => count,
    knowledge: () => 1,
    images: (count) => count,
    web: () => 1
  }).reduce((total, items) => total + items, 0)

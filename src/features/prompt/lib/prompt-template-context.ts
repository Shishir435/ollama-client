import type { PromptTemplateVariableContext } from "./prompt-template-variables"

interface TabTemplateSource {
  title: string
  html: string
}

export const formatPromptTemplateTab = (tab: TabTemplateSource): string =>
  [`Title: ${tab.title || "Untitled"}`, tab.html.trim()]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000)

export const buildPromptTemplateVariableContext = ({
  input,
  selectionStart,
  selectionEnd,
  selectedTabIds,
  tabContents
}: {
  input: string
  selectionStart: number | null
  selectionEnd: number | null
  selectedTabIds: string[]
  tabContents: Record<number, TabTemplateSource | undefined>
}): PromptTemplateVariableContext => {
  const selection =
    selectionStart !== null &&
    selectionEnd !== null &&
    selectionStart !== selectionEnd
      ? input.slice(selectionStart, selectionEnd)
      : ""

  const selectedTabs = selectedTabIds
    .map((id) => tabContents[parseInt(id, 10)])
    .filter((tab): tab is TabTemplateSource => Boolean(tab))

  return {
    selection: selection || undefined,
    tab: selectedTabs[0] ? formatPromptTemplateTab(selectedTabs[0]) : undefined,
    tabs:
      selectedTabs.length > 0
        ? selectedTabs.map(formatPromptTemplateTab).join("\n\n---\n\n")
        : undefined
  }
}

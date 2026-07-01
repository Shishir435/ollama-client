export interface PromptTemplateVariableContext {
  selection?: string
  tab?: string
  tabs?: string
  clipboard?: string
  now?: Date
  variables?: Record<string, string | undefined>
}

const TEMPLATE_VARIABLE_RE = /\{\{\s*([a-zA-Z][\w.-]*)\s*\}\}/g
export const BUILT_IN_PROMPT_TEMPLATE_VARIABLES = [
  "selection",
  "tab",
  "tabs",
  "clipboard",
  "date",
  "time"
] as const

type BuiltInPromptTemplateVariable =
  (typeof BUILT_IN_PROMPT_TEMPLATE_VARIABLES)[number]

export const extractPromptTemplateVariables = (template: string): string[] => {
  const seen = new Set<string>()
  for (const match of template.matchAll(TEMPLATE_VARIABLE_RE)) {
    const name = match[1]?.trim()
    if (name) seen.add(name)
  }
  return Array.from(seen)
}

export const resolvePromptTemplateVariables = (
  template: string,
  context: PromptTemplateVariableContext = {}
): string => {
  const now = context.now ?? new Date()
  const builtIns: Record<BuiltInPromptTemplateVariable, string | undefined> = {
    selection: context.selection,
    tab: context.tab,
    tabs: context.tabs,
    clipboard: context.clipboard,
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString()
  }

  return template.replace(TEMPLATE_VARIABLE_RE, (token, name: string) => {
    const value =
      context.variables?.[name] ??
      builtIns[name as BuiltInPromptTemplateVariable]
    return value == null ? token : value
  })
}

export const hasPromptTemplateVariable = (
  template: string,
  variable: string
): boolean => extractPromptTemplateVariables(template).includes(variable)

import { useCallback } from "react"
import { logger } from "@/lib/logger"
import type { PromptTemplate } from "@/types"
import {
  extractPromptTemplateVariables,
  hasPromptTemplateVariable,
  type PromptTemplateVariableContext,
  resolvePromptTemplateVariables
} from "../lib/prompt-template-variables"

export const usePromptTemplateResolution = (
  variableContext?: PromptTemplateVariableContext
) => {
  const previewPrompt = useCallback(
    (template: PromptTemplate) =>
      resolvePromptTemplateVariables(template.userPrompt, variableContext),
    [variableContext]
  )

  const resolveTemplatePrompt = useCallback(
    async (template: PromptTemplate) => {
      const needsClipboard = hasPromptTemplateVariable(
        template.userPrompt,
        "clipboard"
      )
      const clipboard =
        needsClipboard && navigator.clipboard?.readText
          ? await navigator.clipboard.readText().catch((err) => {
              logger.error(
                "Failed to read clipboard",
                "usePromptTemplateResolution",
                { error: err }
              )
              return undefined
            })
          : variableContext?.clipboard

      return resolvePromptTemplateVariables(template.userPrompt, {
        ...variableContext,
        clipboard
      })
    },
    [variableContext]
  )

  const getVariableNames = useCallback(
    (template: PromptTemplate) =>
      extractPromptTemplateVariables(template.userPrompt),
    []
  )

  return { previewPrompt, resolveTemplatePrompt, getVariableNames }
}

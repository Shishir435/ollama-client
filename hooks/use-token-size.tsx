import { AutoTokenizer } from "@xenova/transformers"
import encoding_for_model from "gpt-tokenizer"
import { useEffect, useRef, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

const tokenizerCache = new Map<string, any>()

export const useTokenSize = (content: string) => {
  const [selectedModel] = useStorage<string>("selected_model", "")
  const [tokenCount, setTokenCount] = useState<number>(0)
  const tokenizerRef = useRef<any>(null)

  useEffect(() => {
    if (!selectedModel || !content) return

    const loadTokenizer = async () => {
      try {
        // Use cached tokenizer if available
        if (tokenizerCache.has(selectedModel)) {
          tokenizerRef.current = tokenizerCache.get(selectedModel)
        } else {
          const tokenizer = await AutoTokenizer.from_pretrained(selectedModel)
          tokenizerRef.current = tokenizer
          tokenizerCache.set(selectedModel, tokenizer)
        }

        const result = await tokenizerRef.current(content)
        const length = Array.isArray(result.input_ids)
          ? result.input_ids.length
          : 0

        setTokenCount(length)
      } catch (err) {
        console.warn(
          `Failed to load tokenizer for "${selectedModel}". Falling back to gpt-tokenizer.`
        )

        try {
          const fallbackTokenizer = encoding_for_model
          const tokens = fallbackTokenizer.encode(content)
          setTokenCount(tokens.length)
        } catch (fallbackErr) {
          console.error("Fallback tokenization failed:", fallbackErr)
          setTokenCount(0)
        }
      }
    }

    loadTokenizer()
  }, [selectedModel, content])

  return tokenCount
}

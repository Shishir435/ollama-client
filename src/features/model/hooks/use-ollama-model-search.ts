import { useEffect, useState } from "react"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { ChromeResponse } from "@/types"

interface ModelMeta {
  name: string
  description?: string
  size?: string
  url?: string
  title?: string
  variants?: string[]
}

const fetchSearchResults = async (query: string): Promise<ModelMeta[]> => {
  const res = (await browser.runtime.sendMessage({
    type: MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL,
    query
  })) as ChromeResponse & { html?: string }

  if (res.error || !res.success || !res.html) {
    throw new Error(res.error?.message || "Failed to fetch search results")
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(res.html, "text/html")
  const results: ModelMeta[] = []

  const links = doc.querySelectorAll("a[href^='/library/']")
  links.forEach((el) => {
    const href = el.getAttribute("href")
    if (!href) return

    const name = href.split("/").pop()
    if (!name) return
    const fullUrl = `https://ollama.com${href}`
    const desc = el.querySelector("p")?.textContent?.trim() ?? ""
    const title = el.querySelector("h3")?.textContent?.trim() ?? ""
    const sizeMatch = desc.match(/(\d+\.?\d*\s?[kKmMgG][bB])/)
    const size = sizeMatch?.[1]?.toUpperCase() ?? ""

    results.push({ name, title, description: desc, size, url: fullUrl })
  })

  return results
}

const fetchModelVariants = async (modelName: string): Promise<string[]> => {
  const res = (await browser.runtime.sendMessage({
    type: MESSAGE_KEYS.OLLAMA.SCRAPE_MODEL_VARIANTS,
    name: modelName
  })) as ChromeResponse & { html?: string }

  if (res.error || !res.success || !res.html) {
    throw new Error(res.error?.message || "Failed to fetch model variants")
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(res.html, "text/html")

  // Find the section tag and get all <a> tags with href attributes inside it
  const section = doc.querySelector("section")

  if (!section) {
    return []
  }

  const linkElements = section.querySelectorAll("a[href]")

  const variants = Array.from(linkElements)
    .map((link) => link.getAttribute("href"))
    .filter(Boolean) // Remove null/undefined values
    .filter((href) => href?.includes("/library/"))
    .map((href) => {
      // Extract model variant from href like "/library/deepseek-r1:latest" -> "deepseek-r1:latest"
      const match = href?.match(/\/library\/(.+)$/)
      return match ? match[1] : null
    })
    .filter(Boolean)
    .filter((variant) => {
      const pattern = new RegExp(
        `^${modelName}:(latest|\\d+(\\.\\d+)?[bB]|[a-zA-Z0-9_+\\-\\.]+)$`
      )
      return variant ? pattern.test(variant) : false
    })

  return [...new Set(variants as string[])]
}

export const useOllamaModelSearch = () => {
  const [models, setModels] = useState<ModelMeta[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!searchQuery) return

    const fetch = async () => {
      setLoading(true)
      try {
        const scraped = await fetchSearchResults(searchQuery)
        setModels(scraped)
      } catch (err) {
        console.error("Scrape failed", err)
        setModels([])
      } finally {
        setLoading(false)
      }
    }

    fetch()
  }, [searchQuery])

  const loadVariants = async (modelName: string) => {
    try {
      const variants = await fetchModelVariants(modelName)
      setModels((prev) =>
        prev.map((m) => (m.name === modelName ? { ...m, variants } : m))
      )
    } catch (err) {
      console.error(`Failed to load variants for ${modelName}`, err)
    }
  }

  return {
    models,
    setSearchQuery,
    loading,
    loadVariants
  }
}

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { browser } from "@/lib/browser-api"
import { DEFAULT_MODEL_LIBRARY_BASE_URL, MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { queryKeys } from "@/lib/query-keys"
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
    type: MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL,
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
    const fullUrl = `${DEFAULT_MODEL_LIBRARY_BASE_URL}${href}`
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
    type: MESSAGE_KEYS.PROVIDER.SCRAPE_MODEL_VARIANTS,
    name: modelName
  })) as ChromeResponse & { html?: string }

  if (res.error || !res.success || !res.html) {
    throw new Error(res.error?.message || "Failed to fetch model variants")
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(res.html, "text/html")

  const section = doc.querySelector("section")
  if (!section) return []

  const linkElements = section.querySelectorAll("a[href]")

  const variants = Array.from(linkElements)
    .map((link) => link.getAttribute("href"))
    .filter(Boolean)
    .filter((href) => href?.includes("/library/"))
    .map((href) => {
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

export const useModelLibrarySearch = () => {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")

  const { data: models = [], isFetching: loading } = useQuery({
    queryKey: queryKeys.model.librarySearch(searchQuery),
    queryFn: () => fetchSearchResults(searchQuery),
    enabled: !!searchQuery,
    // Cache search results for 2 minutes — the library doesn't change that often.
    staleTime: 1000 * 60 * 2,
    // On error, log and resolve to empty array so the UI doesn't break.
    throwOnError: false
  })

  const loadVariants = async (modelName: string) => {
    try {
      const variants = await queryClient.fetchQuery({
        queryKey: queryKeys.model.libraryVariants(modelName),
        queryFn: () => fetchModelVariants(modelName),
        staleTime: 1000 * 60 * 5
      })

      // Merge variants into the cached search result list so callers see the update.
      queryClient.setQueryData<ModelMeta[]>(
        queryKeys.model.librarySearch(searchQuery),
        (prev) =>
          prev?.map((m) => (m.name === modelName ? { ...m, variants } : m)) ??
          []
      )
    } catch (err) {
      logger.error("Failed to load variants", "useModelLibrarySearch", {
        modelName,
        error: err
      })
    }
  }

  return {
    models,
    setSearchQuery,
    loading,
    loadVariants
  }
}

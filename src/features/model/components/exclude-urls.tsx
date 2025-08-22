import { useState } from "react"

import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEFAULT_EXCLUDE_URLS, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { useStorage } from "@plasmohq/storage/hook"

export const ExcludedUrls = () => {
  const [patterns, setPatterns] = useStorage<string[]>(
    {
      key: STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EXCLUDE_URLS
  )

  const [input, setInput] = useState("")

  const handleAdd = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    try {
      new RegExp(trimmed) // validate regex
      if (!patterns.includes(trimmed)) {
        setPatterns([...patterns, trimmed])
        setInput("")
      }
    } catch {
      alert("Invalid regular expression")
    }
  }

  const handleRemove = (pattern: string) => {
    setPatterns(patterns.filter((p) => p !== pattern))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleAdd()
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="exclude-url">Exclude URLs (RegExp)</Label>
        <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
          <Input
            id="exclude-url"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. ^https://example.com/private"
          />
          <Button type="submit" className="whitespace-nowrap">
            Add
          </Button>
        </form>
      </div>

      <ul className="space-y-2 text-sm">
        {patterns.map((pattern) => (
          <li
            key={pattern}
            className="flex items-center justify-between rounded-md border px-3 py-1.5">
            <span className="font-mono text-muted-foreground">{pattern}</span>
            {!DEFAULT_EXCLUDE_URLS.includes(pattern) && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleRemove(pattern)}>
                <Trash2 size={16} className="text-red-500" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

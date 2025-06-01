import { useState } from "react"

import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEFAULT_EXCLUDE_URLS, STORAGE_KEYS } from "@/lib/constant"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { useStorage } from "@plasmohq/storage/hook"

export default function ExcludedUrls() {
  const [patterns, setPatterns] = useStorage<string[]>(
    {
      key: STORAGE_KEYS.BROWSER.EXCLUDE_URL_PATTERNS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EXCLUDE_URLS
  )

  const [input, setInput] = useState("")

  const handleAdd = () => {
    if (!input.trim()) return
    try {
      new RegExp(input) // validate regex
      if (!patterns.includes(input)) {
        setPatterns([...patterns, input])
        setInput("")
      }
    } catch {
      alert("Invalid regular expression")
    }
  }

  const handleRemove = (pattern: string) => {
    setPatterns(patterns.filter((p) => p !== pattern))
  }

  return (
    <div className="space-y-4">
      <Label className="block">Exclude URLs (RegExp)</Label>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. ^https://example.com/private"
        />
        <Button onClick={handleAdd}>Add</Button>
      </div>
      <ul className="space-y-1 text-sm">
        {patterns.map((pattern) => (
          <li key={pattern} className="flex items-center justify-between">
            <span className="font-mono text-gray-700">{pattern}</span>
            {!DEFAULT_EXCLUDE_URLS.includes(pattern) && (
              <Button
                size="sm"
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

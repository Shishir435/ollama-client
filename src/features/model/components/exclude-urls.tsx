import { useState } from "react"

import { AlertCircle, Globe, Plus, Shield, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
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
  const [error, setError] = useState("")

  const handleAdd = () => {
    const trimmed = input.trim()
    if (!trimmed) {
      setError("Pattern cannot be empty")
      return
    }
    try {
      new RegExp(trimmed)
      if (!patterns.includes(trimmed)) {
        setPatterns([trimmed, ...patterns])
        setInput("")
        setError("")
      } else {
        setError("Pattern already exists")
      }
    } catch {
      setError("Invalid regular expression pattern")
    }
  }

  const handleRemove = (pattern: string) => {
    setPatterns(patterns.filter((p) => p !== pattern))
  }

  const handleInputChange = (e) => {
    setInput(e.target.value)
    if (error) setError("")
  }

  const isDefaultPattern = (pattern: string) =>
    DEFAULT_EXCLUDE_URLS.includes(pattern)
  return (
    <div className="mx-auto space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Excluded URLs</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Block extension access from sensitive pages using regex patterns
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="exclude-url" className="text-sm font-medium">
                Add URL Pattern
              </Label>
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    id="exclude-url"
                    value={input}
                    onChange={handleInputChange}
                    placeholder="^https://example\\.com/private.*"
                    className={`h-9 font-mono text-sm ${error ? "border-destructive" : ""}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        handleAdd()
                      }
                    }}
                  />
                  {error && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      {error}
                    </div>
                  )}
                </div>
                <Button
                  onClick={handleAdd}
                  size="sm"
                  className="h-9 whitespace-nowrap px-3"
                  disabled={!input.trim()}>
                  <Plus className="mr-1 h-3 w-3" />
                  Add
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Use regular expressions to match URLs. Examples:{" "}
              <code className="rounded bg-muted px-1">^https://bank\\..*</code>{" "}
              or{" "}
              <code className="rounded bg-muted px-1">.*\\.private\\..*</code>
            </div>
          </div>

          {patterns.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Active Patterns</h4>
                <Badge variant="secondary" className="text-xs">
                  {patterns.length} pattern{patterns.length !== 1 ? "s" : ""}
                </Badge>
              </div>

              <div className="space-y-2">
                {patterns.map((pattern) => (
                  <div
                    key={pattern}
                    className="group flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50">
                    <div className="mr-3 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {pattern}
                        </code>
                        {isDefaultPattern(pattern) && (
                          <Badge variant="outline" className="text-xs">
                            default
                          </Badge>
                        )}
                      </div>
                    </div>

                    {!isDefaultPattern(pattern) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 opacity-60 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        onClick={() => handleRemove(pattern)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-muted-foreground">
              <Shield className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p className="text-sm">No URL patterns configured</p>
              <p className="text-xs">
                Add patterns to block extension access on sensitive pages
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

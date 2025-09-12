import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useResetOllamaStorage } from "@/hooks/use-reset-ollama-storage"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import { CircleCheck, RefreshCcw } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export const ResetStorage = () => {
  const reset = useResetOllamaStorage()
  const keysByModule = getAllResetKeys()
  const [open, setOpen] = useState(false)

  const getModuleIcon = (module: string) => {
    switch (module) {
      case "OLLAMA":
        return "🤖"
      case "THEME":
        return "🎨"
      case "BROWSER":
        return "🌐"
      case "TTS":
        return "🔊"
      case "CHAT_SESSIONS":
        return "💬"
      default:
        return "⚙️"
    }
  }

  const getModuleDescription = (module: string) => {
    switch (module) {
      case "OLLAMA":
        return "Model settings & configurations"
      case "THEME":
        return "UI appearance preferences"
      case "BROWSER":
        return "Tab access & URL patterns"
      case "TTS":
        return "Text-to-speech settings"
      case "CHAT_SESSIONS":
        return "Conversation history"
      default:
        return "Module settings"
    }
  }

  const handleResetAll = async () => {
    await reset("all")
    setOpen(false)
  }

  return (
    <div className="mx-auto space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <RefreshCcw className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Reset Settings</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Clear stored data by module or reset everything to defaults
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3">
            {Object.entries(keysByModule).map(([module, keys]) => {
              const [resetting, setResetting] = useState(false)
              return (
                <div
                  key={module}
                  className="flex items-center justify-between rounded-lg border bg-card p-3 transition-colors hover:bg-accent/50">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex-shrink-0 text-lg">
                      {getModuleIcon(module)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium">
                          {module.replace("_", " ")}
                        </h4>
                        <Badge variant="secondary" className="text-xs">
                          {keys.length} {keys.length === 1 ? "item" : "items"}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {getModuleDescription(module)}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      setResetting(true)
                      await reset(module)
                      setTimeout(() => setResetting(false), 1000)
                    }}>
                    Reset {resetting ? <CircleCheck className="h-4 w-4" /> : ""}
                  </Button>
                </div>
              )
            })}
          </div>

          <Separator />

          <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <div className="flex items-center gap-3">
              <RefreshCcw className="h-4 w-4 flex-shrink-0 text-destructive" />
              <div>
                <h4 className="text-sm font-medium text-destructive">
                  Danger Zone
                </h4>
                <p className="text-xs text-muted-foreground">
                  This will clear all data and cannot be undone
                </p>
              </div>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <span
                  className={cn(buttonVariants({ variant: "destructive" }))}>
                  Reset All
                </span>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm Reset</DialogTitle>
                  <DialogDescription>
                    This will clear all data and cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex flex-col gap-4">
                  <Button variant="destructive" onClick={handleResetAll}>
                    Yes, Reset All
                  </Button>
                  <Button variant="secondary" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

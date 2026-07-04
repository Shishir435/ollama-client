import { Bot, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface AgentRunHeaderProps {
  enabled: boolean
  running: boolean
  onEnabledChange: (enabled: boolean) => void
  onStop: () => void
}

/**
 * App-owned agent control surface. AI Elements informs hierarchy only; this
 * component uses existing shadcn primitives and product tokens.
 */
export const AgentRunHeader = ({
  enabled,
  running,
  onEnabledChange,
  onStop
}: AgentRunHeaderProps) => (
  <div
    className={cn(
      "mb-2 flex items-center gap-2 rounded-panel border px-2.5 py-2 text-xs",
      enabled
        ? "border-app-primary/35 bg-app-primary-soft/45"
        : "border-border/50 bg-muted/25"
    )}
    aria-live="polite">
    <span className="grid size-7 shrink-0 place-items-center rounded-control bg-background shadow-xs">
      <Bot className="icon-sm text-app-primary" aria-hidden="true" />
    </span>
    <div className="min-w-0 flex-1">
      <div className="truncate font-medium">
        {enabled ? "Browser agent" : "Chat mode"}
      </div>
      <div className="truncate text-muted-foreground">
        {running
          ? "Working one verified step at a time"
          : enabled
            ? "Page actions require approval"
            : "Enable for browser tasks"}
      </div>
    </div>
    {running ? (
      <Button type="button" variant="destructive" size="sm" onClick={onStop}>
        <Square className="icon-xs" />
        Stop
      </Button>
    ) : (
      <Button
        type="button"
        variant={enabled ? "secondary" : "outline"}
        size="sm"
        aria-pressed={enabled}
        onClick={() => onEnabledChange(!enabled)}>
        {enabled ? "Agent on" : "Enable agent"}
      </Button>
    )}
  </div>
)

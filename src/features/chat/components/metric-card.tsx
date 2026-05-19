import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

const COLOR_MAP = {
  blue: "text-muted-foreground",
  emerald: "text-muted-foreground",
  purple: "text-muted-foreground",
  amber: "text-muted-foreground",
  rose: "text-muted-foreground",
  indigo: "text-muted-foreground",
  gray: "text-muted-foreground"
}

interface MetricCardProps {
  value: string
  color?: keyof typeof COLOR_MAP
  icon: LucideIcon
  tooltip: string
}

export const MetricCard = ({
  value,
  color = "gray",
  icon: Icon,
  tooltip
}: MetricCardProps) => {
  const colorClass = COLOR_MAP[color]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex cursor-help items-center gap-1 rounded-md bg-muted/30 px-1 py-0.5 text-xs font-medium transition-colors hover:bg-muted/50",
            colorClass
          )}>
          <Icon className="size-3" />
          <span>{value}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}

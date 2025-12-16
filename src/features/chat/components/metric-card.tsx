import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import type { LucideIcon } from "@/lib/lucide-icon"

const COLOR_MAP = {
  blue: "text-blue-600 dark:text-blue-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  purple: "text-purple-600 dark:text-purple-400",
  amber: "text-amber-600 dark:text-amber-400",
  rose: "text-rose-600 dark:text-rose-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  gray: "text-gray-500 dark:text-gray-400"
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
          className={`flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium bg-muted/30 hover:bg-muted/50 transition-colors ${colorClass} cursor-help`}>
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

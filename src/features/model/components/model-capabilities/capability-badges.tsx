import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip"
import type { ModelCapabilities } from "@/lib/providers/capabilities"
import { cn } from "@/lib/utils"

import { BADGE_FLAGS, CAPABILITY_META } from "./capability-meta"

interface ModelCapabilityBadgesProps {
  caps: ModelCapabilities
  className?: string
}

/**
 * Compact, icon-only badges for the capabilities a model has, in the same order
 * Ollama lists them (completion, vision, tools, thinking, embeddings). Each
 * badge has a tooltip with its label + description. Renders nothing when the
 * model has no known capability, so unknown-capability rows stay visually quiet.
 */
export const ModelCapabilityBadges = ({
  caps,
  className
}: ModelCapabilityBadgesProps) => {
  const { t } = useTranslation()

  const active = BADGE_FLAGS.map((flag) =>
    CAPABILITY_META.find((meta) => meta.flag === flag)
  ).filter(
    (meta) => meta && caps[meta.flag]
  ) as (typeof CAPABILITY_META)[number][]

  if (active.length === 0) return null

  return (
    <TooltipProvider delay={150}>
      <div className={cn("flex items-center gap-1", className)}>
        {active.map(({ flag, icon: Icon, labelKey }) => {
          const label = t(labelKey)
          return (
            <Tooltip key={flag}>
              <TooltipTrigger
                render={
                  <Badge
                    variant="outline"
                    aria-label={label}
                    className="h-4 gap-0.5 px-1 text-micro font-medium text-muted-foreground border-border/50">
                    <Icon className="icon-xs" aria-hidden="true" />
                  </Badge>
                }
              />
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

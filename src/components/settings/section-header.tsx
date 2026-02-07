import { MiniBadge } from "@/components/ui/mini-badge"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

interface SectionHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  badge?: string
  className?: string
}

export const SectionHeader = ({
  title,
  description,
  icon: Icon,
  badge,
  className
}: SectionHeaderProps) => {
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
        <h3 className="text-sm font-semibold">{title}</h3>
        {badge && <MiniBadge text={badge} />}
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

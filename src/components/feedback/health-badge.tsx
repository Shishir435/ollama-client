import { MiniBadge } from "@/components/ui/mini-badge"
import { cn } from "@/lib/utils"

type HealthTone = "success" | "warning" | "danger" | "info" | "neutral"

interface HealthBadgeProps {
  label: string
  tone?: HealthTone
  className?: string
}

const toneClass: Record<HealthTone, string> = {
  success: "border-status-success/30 text-status-success",
  warning: "border-status-warning/30 text-status-warning",
  danger: "border-status-danger/30 text-status-danger",
  info: "border-status-info/30 text-status-info",
  neutral: "border-border text-muted-foreground"
}

export const HealthBadge = ({
  label,
  tone = "neutral",
  className
}: HealthBadgeProps) => (
  <MiniBadge text={label} className={cn(toneClass[tone], className)} />
)

export const CapabilityBadge = HealthBadge

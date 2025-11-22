import { cn } from "@/lib/utils"

interface MiniBadgeProps {
  text: string
  className?: string
}

export const MiniBadge = ({ text, className }: MiniBadgeProps) => {
  return (
    <span
      className={cn(
        "text-[10px] font-medium text-muted-foreground/80 border border-border rounded px-1 py-0.5 leading-none",
        className
      )}>
      {text}
    </span>
  )
}

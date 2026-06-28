import type { ReactNode } from "react"

interface IconBadgeProps {
  icon: ReactNode
  count: number
  showZero?: boolean
}

export const IconBadge = ({ icon, count, showZero }: IconBadgeProps) => {
  if (!showZero && count <= 0) return <>{icon}</>

  return (
    <div className="relative">
      {icon}
      <span className="absolute -right-1 -top-1 flex h-3 min-w-3 items-center justify-center rounded-chip px-0.5 text-nano font-bold leading-none text-primary-foreground tabular-nums bg-primary">
        {count > 9 ? "9+" : count}
      </span>
    </div>
  )
}

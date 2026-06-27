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
      <span className="absolute -right-1 -top-1 flex size-2.5 items-center justify-center rounded-chip bg-primary text-micro font-bold text-primary-foreground">
        {count}
      </span>
    </div>
  )
}

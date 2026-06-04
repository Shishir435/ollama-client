import type React from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type FeatureColor = "green" | "blue" | "purple" | "indigo"

export const COLOR_VARIANTS: Record<
  FeatureColor,
  { border: string; bg: string; iconBg: string }
> = {
  green: {
    border: "border-feature-1/25 hover:border-feature-1/45",
    bg: "bg-feature-1/8 hover:bg-feature-1/12",
    iconBg: "bg-feature-1"
  },
  blue: {
    border: "border-feature-2/25 hover:border-feature-2/45",
    bg: "bg-feature-2/8 hover:bg-feature-2/12",
    iconBg: "bg-feature-2"
  },
  purple: {
    border: "border-feature-3/25 hover:border-feature-3/45",
    bg: "bg-feature-3/8 hover:bg-feature-3/12",
    iconBg: "bg-feature-3"
  },
  indigo: {
    border: "border-feature-4/25 hover:border-feature-4/45",
    bg: "bg-feature-4/8 hover:bg-feature-4/12",
    iconBg: "bg-feature-4"
  }
}

export const FeatureCard = ({
  icon: Icon,
  color,
  title,
  description
}: {
  icon: React.ComponentType<{ className?: string }>
  color: FeatureColor
  title: string
  description: string
}) => {
  const { border, bg, iconBg } = COLOR_VARIANTS[color]

  return (
    <Card
      className={cn(
        "group gap-4 p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-sm ring-0 border",
        border,
        bg
      )}>
      <div
        className={cn(
          "flex size-11 items-center justify-center rounded-[14px] shadow-sm transition-transform duration-300 group-hover:scale-110",
          iconBg
        )}>
        <Icon className="size-5 text-background" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold leading-tight text-foreground">
          {title}
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </Card>
  )
}

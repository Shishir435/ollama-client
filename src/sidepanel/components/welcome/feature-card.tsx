import type React from "react"
import { cn } from "@/lib/utils"

export type FeatureColor = "green" | "blue" | "purple" | "indigo"

export const COLOR_VARIANTS: Record<
  FeatureColor,
  { border: string; bg: string; iconBg: string }
> = {
  green: {
    border: "border-emerald-500/20 hover:border-emerald-500/40",
    bg: "bg-emerald-500/5 hover:bg-emerald-500/10",
    iconBg: "bg-emerald-500"
  },
  blue: {
    border: "border-sky-500/20 hover:border-sky-500/40",
    bg: "bg-sky-500/5 hover:bg-sky-500/10",
    iconBg: "bg-sky-500"
  },
  purple: {
    border: "border-violet-500/20 hover:border-violet-500/40",
    bg: "bg-violet-500/5 hover:bg-violet-500/10",
    iconBg: "bg-violet-500"
  },
  indigo: {
    border: "border-indigo-500/20 hover:border-indigo-500/40",
    bg: "bg-indigo-500/5 hover:bg-indigo-500/10",
    iconBg: "bg-indigo-500"
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
    <div
      className={cn(
        "group flex flex-col gap-4 rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md",
        border,
        bg
      )}>
      <div
        className={cn(
          "flex size-11 items-center justify-center rounded-[14px] shadow-sm transition-transform duration-300 group-hover:scale-110",
          iconBg
        )}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold leading-tight text-foreground">
          {title}
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  )
}

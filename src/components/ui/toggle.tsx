"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/class-names"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-control text-xs font-medium whitespace-nowrap transition-all outline-none hover:bg-state-hover hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-focus disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-invalid aria-invalid:ring-invalid aria-pressed:bg-state-selected data-[state=on]:bg-state-selected [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='icon-'])]:icon-md",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent hover:bg-state-hover"
      },
      size: {
        default:
          "h-7 min-w-7 px-2 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        sm: "h-6 min-w-6 rounded-[min(var(--radius-md),8px)] px-2 text-micro has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='icon-'])]:icon-xs",
        lg: "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }

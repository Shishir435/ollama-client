import type { VariantProps } from "class-variance-authority"
import type { ComponentPropsWithoutRef } from "react"
import { buttonVariants } from "@/components/ui/button"
import type { LucideIcon } from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>

interface SocialLinkButtonProps
  extends Omit<
    ComponentPropsWithoutRef<"a">,
    "href" | "children" | "aria-label"
  > {
  href: string
  label: string
  "aria-label"?: string
  icon: LucideIcon
  buttonVariant?: ButtonVariant
  iconSize?: number
  size?: "default" | "compact"
  iconOnly?: boolean
  showFocusRing?: boolean
  showShadow?: boolean
  className?: string
}

export const SocialLinkButton = ({
  href,
  label,
  "aria-label": ariaLabel,
  icon: Icon,
  buttonVariant = "outline",
  iconSize = 18,
  size = "default",
  iconOnly = false,
  showFocusRing = true,
  showShadow = true,
  className,
  ...anchorProps
}: SocialLinkButtonProps) => {
  const computedAriaLabel = ariaLabel || label
  const buttonSize = (() => {
    if (iconOnly) {
      return size === "compact" ? "icon-sm" : "icon"
    }
    return size === "compact" ? "sm" : "default"
  })()

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...anchorProps}
      className={cn(
        buttonVariants({
          variant: buttonVariant,
          size: buttonSize
        }),
        "group shrink-0 gap-2",
        !showFocusRing &&
          "focus-visible:ring-0 focus-visible:border-transparent",
        !showShadow && "shadow-none hover:shadow-none",
        className
      )}
      aria-label={computedAriaLabel}
      style={{ willChange: "transform, box-shadow" }}>
      <div className="shrink-0 transition-transform duration-200 group-hover:scale-110">
        <Icon
          size={iconSize}
          className="drop-shadow-xs transition-all duration-200 group-hover:drop-shadow-md"
        />
      </div>
      {!iconOnly && (
        <span className="whitespace-nowrap transition-all duration-200 group-hover:text-foreground">
          {label}
        </span>
      )}
    </a>
  )
}

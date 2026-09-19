import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/class-names"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-micro font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-focus has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-border-invalid aria-invalid:ring-ring-invalid [&>svg]:pointer-events-none [&>svg]:icon-micro!",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-tint-danger text-destructive focus-visible:ring-ring-invalid [a]:hover:bg-tint-danger-hover",
        outline:
          "border-border bg-surface-sunken text-foreground [a]:hover:bg-state-hover [a]:hover:text-muted-foreground",
        ghost: "hover:bg-state-hover hover:text-muted-foreground ",
        link: "text-primary underline-offset-4 hover:underline"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className)
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant
    }
  })
}

export { Badge, badgeVariants }

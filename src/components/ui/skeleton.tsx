import { cn } from "@/lib/class-names"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-control bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }

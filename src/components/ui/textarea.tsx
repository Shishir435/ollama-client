import type * as React from "react"

import { cn } from "@/lib/class-names"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-control border border-input bg-surface-sunken px-2 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-invalid aria-invalid:ring-2 aria-invalid:ring-invalid md:text-xs/relaxed   ",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }

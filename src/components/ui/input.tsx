import { Input as InputPrimitive } from "@base-ui/react/input"
import type * as React from "react"

import { cn } from "@/lib/class-names"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-7 w-full min-w-0 rounded-control border border-input bg-surface-sunken px-2 py-0.5 text-sm transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-invalid aria-invalid:ring-2 aria-invalid:ring-invalid md:text-xs/relaxed   ",
        className
      )}
      {...props}
    />
  )
}

export { Input }

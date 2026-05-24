import type React from "react"

import { cn } from "@/lib/utils"

export const AppShell = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    className={cn(
      "flex h-screen flex-col overflow-hidden bg-background text-foreground",
      className
    )}
    {...props}
  />
)

export const PageHeader = ({
  className,
  ...props
}: React.ComponentProps<"header">) => (
  <header
    className={cn("flex-none border-b bg-background", className)}
    {...props}
  />
)

export const PageStack = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("space-y-8", className)} {...props} />
)

export const SectionStack = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("space-y-6", className)} {...props} />
)

export const FieldStack = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("space-y-4", className)} {...props} />
)

export const ControlStack = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("space-y-2", className)} {...props} />
)

export const PageBody = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    className={cn(
      "container mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
      className
    )}
    {...props}
  />
)

export const TwoColumnGrid = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("grid gap-6 lg:grid-cols-2", className)} {...props} />
)

export const ResponsiveGrid = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("grid gap-6", className)} {...props} />
)

export const FormGrid = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("grid gap-4 sm:grid-cols-2", className)} {...props} />
)

export const CompactGrid = FormGrid

export const DenseFormGrid = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div className={cn("grid grid-cols-2 gap-4", className)} {...props} />
)

export const Toolbar = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    className={cn(
      "flex flex-wrap items-center justify-between gap-2",
      className
    )}
    {...props}
  />
)

export const InlineActions = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    className={cn("flex flex-wrap items-center gap-2", className)}
    {...props}
  />
)

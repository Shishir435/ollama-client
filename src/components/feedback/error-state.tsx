import type React from "react"

import { AlertTriangle } from "@/lib/lucide-icon"

import { StatusCallout } from "./status-callout"

interface ErrorStateProps {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export const ErrorState = (props: ErrorStateProps) => (
  <StatusCallout variant="danger" icon={AlertTriangle} {...props} />
)

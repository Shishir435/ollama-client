export interface NetworkError extends Error {
  status?: number
  statusText?: string
}

export interface ParseError extends Error {
  line?: string
  data?: unknown
}

export type { AppErrorKind } from "@/lib/error-utils"

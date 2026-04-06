import { Toast } from "@base-ui/react/toast"
import type { ReactNode } from "react"
import type { ToastActionElement } from "@/components/ui/toast"

type ToastVariant = "default" | "destructive"

export type ToastOptions = {
  title?: ReactNode
  description?: ReactNode
  action?: ToastActionElement
  variant?: ToastVariant
  duration?: number
}

type ToastData = {
  action?: ToastActionElement
}

export const toastManager = Toast.createToastManager<ToastData>()

const normalizeTimeout = (duration?: number) => {
  if (duration === undefined) {
    return undefined
  }

  if (duration === Number.POSITIVE_INFINITY) {
    return 0
  }

  return duration
}

const toAddOptions = (options: ToastOptions) => ({
  title: options.title,
  description: options.description,
  timeout: normalizeTimeout(options.duration),
  type: options.variant === "destructive" ? "destructive" : undefined,
  data: options.action ? { action: options.action } : undefined
})

const toUpdateOptions = (options: ToastOptions) => ({
  title: options.title,
  description: options.description,
  timeout: normalizeTimeout(options.duration),
  type:
    options.variant === undefined
      ? undefined
      : options.variant === "destructive"
        ? "destructive"
        : undefined,
  data: options.action ? { action: options.action } : undefined
})

function toast(options: ToastOptions) {
  const id = toastManager.add(toAddOptions(options))

  return {
    id,
    dismiss: () => toastManager.close(id),
    update: (updates: ToastOptions) => {
      toastManager.update(id, toUpdateOptions(updates))
    }
  }
}

function useToast() {
  return {
    toast,
    dismiss: (toastId?: string) => toastManager.close(toastId),
    update: (toastId: string, updates: ToastOptions) => {
      toastManager.update(toastId, toUpdateOptions(updates))
    },
    promise: toastManager.promise
  }
}

export { useToast, toast }

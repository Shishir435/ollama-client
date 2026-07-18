import type { ReactNode } from "react"
import { type Action, toast as sonnerToast } from "sonner"

type ToastVariant = "default" | "destructive"

export type ToastOptions = {
  title?: ReactNode
  description?: ReactNode
  action?: Action | ReactNode
  variant?: ToastVariant
  duration?: number
}

const normalizeTimeout = (duration?: number) => {
  if (duration === undefined) return undefined
  if (duration === Number.POSITIVE_INFINITY) return Infinity
  return duration
}

function toast(options: ToastOptions) {
  const { title, description, action, variant, duration } = options
  const isDestructive = variant === "destructive"

  const toastFn = isDestructive ? sonnerToast.error : sonnerToast
  const sonnerDuration = normalizeTimeout(duration)

  let message = title
  let optDesc = description

  // If there's only a description and no title, use description as the title/message
  if (!message && description) {
    message = description
    optDesc = undefined
  }

  const id = toastFn(message, {
    description: optDesc,
    action,
    duration: sonnerDuration
  })

  return {
    id,
    dismiss: () => sonnerToast.dismiss(id),
    update: (updates: ToastOptions) => {
      const updateFn =
        updates.variant === "destructive" ? sonnerToast.error : sonnerToast
      const updateDuration = normalizeTimeout(updates.duration)

      let updMsg = updates.title
      let updDesc = updates.description
      if (!updMsg && updates.description) {
        updMsg = updates.description
        updDesc = undefined
      }

      updateFn(updMsg, {
        id,
        description: updDesc,
        action: updates.action,
        duration: updateDuration
      })
    }
  }
}

function useToast() {
  return {
    toast,
    dismiss: (toastId?: string | number) => sonnerToast.dismiss(toastId),
    update: (toastId: string | number, updates: ToastOptions) => {
      const updateFn =
        updates.variant === "destructive" ? sonnerToast.error : sonnerToast
      const updateDuration = normalizeTimeout(updates.duration)

      let updMsg = updates.title
      let updDesc = updates.description
      if (!updMsg && updates.description) {
        updMsg = updates.description
        updDesc = undefined
      }

      updateFn(updMsg, {
        id: toastId,
        description: updDesc,
        action: updates.action,
        duration: updateDuration
      })
    }
  }
}

export { toast, useToast }

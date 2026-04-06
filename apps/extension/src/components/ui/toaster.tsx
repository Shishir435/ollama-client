import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import type { ReactNode } from "react"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport
} from "@/components/ui/toast"
import { toastManager } from "@/hooks/use-toast"

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager<{
    action?: ReactNode
  }>()

  return (
    <>
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          variant={toast.type === "destructive" ? "destructive" : "default"}>
          <div className="grid gap-1">
            {toast.title && <ToastTitle>{toast.title}</ToastTitle>}
            {toast.description && (
              <ToastDescription>{toast.description}</ToastDescription>
            )}
          </div>
          {toast.data?.action}
          <ToastClose />
        </Toast>
      ))}
    </>
  )
}

export function Toaster() {
  return (
    <ToastProvider toastManager={toastManager} limit={1}>
      <ToastList />
      <ToastViewport />
    </ToastProvider>
  )
}

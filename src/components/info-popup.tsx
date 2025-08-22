import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type AlertType = "error" | "warning" | "info" | "success"

const iconMap = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle
}

const colorMap = {
  error: "text-red-600",
  warning: "text-yellow-600",
  info: "text-blue-600",
  success: "text-green-600"
}

export const InfoPopup = ({
  open,
  onClose,
  title,
  message,
  type = "info",
  actionButton
}: {
  open: boolean
  onClose: () => void
  title: string
  message: string
  type?: AlertType
  actionButton?: React.ReactNode
}) => {
  const Icon = iconMap[type]
  const color = colorMap[type]

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="rounded-md sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Icon size={20} className={cn(color)} />
            <DialogTitle className={cn(color)}>{title}</DialogTitle>
          </div>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            {message}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {actionButton}
        </div>
      </DialogContent>
    </Dialog>
  )
}

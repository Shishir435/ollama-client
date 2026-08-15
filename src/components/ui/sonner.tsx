import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useThemeStore } from "@/stores/theme"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useThemeStore((state) => state.theme)

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="icon-md" />,
        info: <InfoIcon className="icon-md" />,
        warning: <TriangleAlertIcon className="icon-md" />,
        error: <OctagonXIcon className="icon-md" />,
        loading: <Loader2Icon className="icon-md animate-spin" />
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)"
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast"
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
